#!/usr/bin/env python3
"""Local server for the Hakka learning app with TTS audio proxy.

Usage:  python3 serve.py
Opens:  http://localhost:8300

Proxies TTS requests to gohakka.org so the browser doesn't hit CORS issues.
"""

import http.server
import urllib.request
import urllib.parse
import os
import sys
import json

PORT = 8300
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

class HakkaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_POST(self):
        if self.path == "/tts":
            self.proxy_tts()
        else:
            self.send_error(404)

    def proxy_tts(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        try:
            params = urllib.parse.parse_qs(body.decode("utf-8"))
            dialect_code = params.get("dialect", ["xii"])[0]
            toivun = params.get("toivun", [""])[0]
        except Exception:
            self.send_error(400, "Bad request")
            return

        if not toivun.strip():
            self.send_error(400, "Missing toivun parameter")
            return

        url = f"https://tts-{dialect_code}.gohakka.org"
        form_data = urllib.parse.urlencode({
            "toivun": toivun,
            "socoi": "output.wav",
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                audio = resp.read()
                content_type = resp.headers.get("Content-Type", "audio/wav")

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as e:
            self.send_error(502, f"TTS upstream error: {e}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self):
        if self.command == "GET":
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    with http.server.HTTPServer(("", PORT), HakkaHandler) as httpd:
        print(f"\n  學客話 Learn Hakka")
        print(f"  ─────────────────")
        print(f"  Open http://localhost:{PORT}/hakka-standalone.html\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
