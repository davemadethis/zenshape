// Packs PNGs into a Windows .ico (PNG-compressed entries, Vista and later).
// Usage: node png-to-ico.cjs out.ico a.png b.png …  (each ≤256px square)
const fs = require('node:fs');

const [out, ...inputs] = process.argv.slice(2);
const images = inputs.map((f) => fs.readFileSync(f));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((png) => {
  const size = png.readUInt32BE(16); // IHDR width
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images]));
