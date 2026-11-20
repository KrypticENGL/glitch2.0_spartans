// Renders the SURAKSHA mark (src/components/layout/brand.tsx) into PWA icons. Run: node scripts/generate-icons.mjs
import sharp from "sharp";

const glyph = (stroke = "#fff", water = "#70D1C4") => `
  <path d="M8 15.5 16 9l8 6.5" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11 15v4h10v-4" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M6.5 23c2.4-1.6 4.4-1.6 6.4 0s4 1.6 6.3 0 4.2-1.6 6.3 0" fill="none" stroke="${water}" stroke-width="2" stroke-linecap="round"/>`;

// "any": rounded tile like the in-app mark. "maskable": full-bleed, glyph inside the 80% safe zone.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1B3034"/>${glyph()}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1B3034"/><g transform="translate(16 16) scale(0.72) translate(-16 -16)">${glyph()}</g></svg>`;
// Badge: Android shows only the alpha channel, so a white glyph on transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="translate(16 16) scale(1.15) translate(-16 -16.5)">${glyph("#fff", "#fff")}</g></svg>`;

const out = [
  [any, 192, "icon-192.png"],
  [any, 512, "icon-512.png"],
  [maskable, 192, "maskable-192.png"],
  [maskable, 512, "maskable-512.png"],
  [maskable, 180, "apple-touch-icon.png"],
  [badge, 96, "badge-96.png"],
];
for (const [svg, size, name] of out) {
  await sharp(Buffer.from(svg), { density: 72 * (size / 32) }).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log(name);
}
