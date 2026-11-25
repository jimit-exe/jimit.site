// Generates public/og-default.png, the site-wide share image (1200x630).
// Run: node scripts/make-og-image.mjs
import sharp from 'sharp';

const mono = "Menlo, 'DejaVu Sans Mono', monospace";
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0f14"/>
  <rect x="60" y="60" width="1080" height="510" rx="18" fill="#111821" stroke="#233040" stroke-width="2"/>
  <rect x="60" y="60" width="1080" height="56" rx="18" fill="#17202b"/>
  <rect x="60" y="98" width="1080" height="18" fill="#17202b"/>
  <line x1="60" y1="116" x2="1140" y2="116" stroke="#233040" stroke-width="2"/>
  <circle cx="98" cy="88" r="8" fill="#ff5f57"/><circle cx="126" cy="88" r="8" fill="#febc2e"/><circle cx="154" cy="88" r="8" fill="#28c840"/>
  <text x="600" y="95" text-anchor="middle" font-family="${mono}" font-size="20" fill="#8b98a8">~/jimitpatel</text>
  <text x="110" y="200" font-family="${mono}" font-size="30" fill="#4ade80">$ <tspan fill="#c9d4e0">whoami</tspan></text>
  <text x="106" y="300" font-family="${sans}" font-weight="700" font-size="84" fill="#f2f6fa" letter-spacing="-2">Jimit Patel</text>
  <text x="110" y="366" font-family="${mono}" font-size="32" fill="#4ade80">Offensive Security &amp; AI Red Teaming</text>
  <text x="110" y="440" font-family="${sans}" font-size="28" fill="#a3b0bf">Writeups · projects · methodology</text>
  <text x="110" y="512" font-family="${mono}" font-size="26" fill="#8b98a8">jimit.site<tspan fill="#4ade80">▍</tspan></text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile('public/og-default.png');
console.log('Wrote public/og-default.png');
