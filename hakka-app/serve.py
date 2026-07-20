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

PORT = 8300
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(SCRIPT_DIR, "public")
HTML_FILE = os.path.join(PUBLIC_DIR, "hakka-standalone.html")


class HakkaHandler(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path in ("/", "/index.html", "/hakka-standalone.html"):
            self.serve_html()
        else:
            self.send_error(404)

    def serve_html(self):
        if not os.path.isfile(HTML_FILE):
            self.send_error(500, f"Cannot find {HTML_FILE}")
            return
        with open(HTML_FILE, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
            self.end_headers()
            self.wfile.write(audio)
        except Exception as e:
            self.send_error(502, f"TTS upstream error: {e}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        path = args[0].split()[1] if args else ""
        if path == "/tts":
            sys.stderr.write(f"  TTS request: {args}\n")


if __name__ == "__main__":
    if not os.path.isfile(HTML_FILE):
        print(f"Error: Cannot find {HTML_FILE}")
        print(f"Make sure you run this from the hakka-app directory:")
        print(f"  cd hakka-app && python3 serve.py")
        sys.exit(1)

    with http.server.HTTPServer(("", PORT), HakkaHandler) as httpd:
        print(f"\n  學客話 Learn Hakka")
        print(f"  ─────────────────")
        print(f"  Open http://localhost:{PORT}\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
