const fs = require("fs");
const path = require("path");

function createSVG(size, maskable) {
  const pad = maskable ? Math.round(size * 0.1) : 0;
  const inner = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = inner / 2;
  const shieldR = r * 0.7;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#2563eb" rx="${maskable ? 0 : size * 0.2}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="#1d4ed8"/>
  <text x="${cx}" y="${cy + inner * 0.12}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${inner * 0.32}" fill="white">Ox</text>
  <text x="${cx}" y="${cy + inner * 0.32}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="400" font-size="${inner * 0.11}" fill="#93c5fd">Ca</text>
  <circle cx="${cx}" cy="${cy - inner * 0.22}" r="${inner * 0.08}" fill="none" stroke="#34d399" stroke-width="${inner * 0.02}"/>
  <line x1="${cx - inner * 0.04}" y1="${cy - inner * 0.22}" x2="${cx + inner * 0.04}" y2="${cy - inner * 0.22}" stroke="#34d399" stroke-width="${inner * 0.015}"/>
  <line x1="${cx}" y1="${cy - inner * 0.26}" x2="${cx}" y2="${cy - inner * 0.18}" stroke="#34d399" stroke-width="${inner * 0.015}"/>
</svg>`;
}

const iconDir = path.join(__dirname, "public", "icons");

const variants = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-maskable-192.png", size: 192, maskable: true },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: false },
];

for (const v of variants) {
  const svg = createSVG(v.size, v.maskable);
  fs.writeFileSync(path.join(iconDir, v.name.replace(".png", ".svg")), svg);
  console.log(`Created ${v.name.replace(".png", ".svg")}`);
}
