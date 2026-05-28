// Rasterizes the SVG assets to PNGs at the sizes Intercom and most
// social-media OG previews expect. Re-run any time the SVGs change:
//
//   npm run logos
//
// Outputs (all in assets/):
//   logo-192.png, logo-256.png, logo-512.png   — app icons
//   og.png (1200x630)                          — social preview card
//   apple-touch-icon.png (180x180)             — iOS home-screen icon

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

const logoSvg = await readFile(join(assets, 'logo.svg'));
const ogSvg = await readFile(join(assets, 'og.svg'));

const renders = [
  { svg: logoSvg, size: 192, name: 'logo-192.png' },
  { svg: logoSvg, size: 256, name: 'logo-256.png' },
  { svg: logoSvg, size: 512, name: 'logo-512.png' },
  { svg: logoSvg, size: 180, name: 'apple-touch-icon.png' },
  { svg: ogSvg, width: 1200, height: 630, name: 'og.png' },
];

for (const r of renders) {
  const resize = r.size
    ? { width: r.size, height: r.size }
    : { width: r.width, height: r.height };
  const out = join(assets, r.name);
  await sharp(r.svg, { density: 384 })
    .resize(resize)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  ${r.name}  ${resize.width}x${resize.height}`);
}

console.log(`\nDone. ${renders.length} PNGs written to assets/.`);
