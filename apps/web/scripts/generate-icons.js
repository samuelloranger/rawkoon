#!/usr/bin/env node

/**
 * Script to generate PNG icons from SVG for PWA
 * Generates icons at: 32x32, 192x192, 512x512, and 180x180 (apple-touch-icon)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgPath = path.join(__dirname, "../public/icon.svg");
const publicDir = path.join(__dirname, "../public");

// Icon sizes to generate
const iconSizes = [
  { size: 32, name: "icon-32.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
];

async function generateIcons() {
  try {
    // Check if sharp is available
    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      console.error("Error: sharp package not found.");
      console.error("Please install sharp: bun add -D sharp");
      console.error("\nAlternatively, you can convert the SVG manually using:");
      console.error(
        "  - ImageMagick: convert -background none -resize SIZExSIZE public/icon.svg public/ICON_NAME.png",
      );
      console.error("  - Online tools: https://cloudconvert.com/svg-to-png");
      process.exit(1);
    }

    // Read SVG
    if (!fs.existsSync(svgPath)) {
      console.error(`Error: SVG file not found at ${svgPath}`);
      process.exit(1);
    }

    console.log("Generating PNG icons from SVG...\n");

    // Generate each icon size
    for (const { size, name } of iconSizes) {
      const outputPath = path.join(publicDir, name);

      await sharp(svgPath)
        .resize(size, size, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ Generated ${name} (${size}x${size})`);
    }

    console.log("\n✓ All icons generated successfully!");
    console.log("Icons are ready in the public directory.");
  } catch (error) {
    console.error("Error generating icons:", error.message);
    process.exit(1);
  }
}

generateIcons();
