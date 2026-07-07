import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");
const svgBuffer = readFileSync(resolve(publicDir, "icon.svg"));

const sizes: Array<{ file: string; size: number }> = [
  { file: "icon-512.png", size: 512 },
  { file: "icon-192.png", size: 192 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-32.png", size: 32 },
];

for (const { file, size } of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, file));
  console.log(`✓ Generated ${file} (${size}×${size})`);
}
