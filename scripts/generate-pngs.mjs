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
const badgeNewSvg = await readFile(join(assets, 'badge-new.svg'));
const badgeImprovedSvg = await readFile(join(assets, 'badge-improved.svg'));
const badgeFixedSvg = await readFile(join(assets, 'badge-fixed.svg'));

const renders = [
  { svg: logoSvg, size: 192, name: 'logo-192.png' },
  { svg: logoSvg, size: 256, name: 'logo-256.png' },
  { svg: logoSvg, size: 512, name: 'logo-512.png' },
  { svg: logoSvg, size: 180, name: 'apple-touch-icon.png' },
  { svg: ogSvg, width: 1200, height: 630, name: 'og.png' },
  // Canvas Kit list item badges — rendered at 96x96 for crisp display at
  // the avatar size Intercom uses (~24-32px).
  { svg: badgeNewSvg, size: 96, name: 'badge-new.png' },
  { svg: badgeImprovedSvg, size: 96, name: 'badge-improved.png' },
  { svg: badgeFixedSvg, size: 96, name: 'badge-fixed.png' },
  // Pill-shaped wide variants (with the full word) for use as list-item images
  // when 3:1 aspect ratio is desired. 360x120 = 6x retina density.
  {
    svg: await readFile(join(assets, 'pill-new.svg')),
    width: 360, height: 120, name: 'pill-new.png',
  },
  {
    svg: await readFile(join(assets, 'pill-improved.svg')),
    width: 360, height: 120, name: 'pill-improved.png',
  },
  {
    svg: await readFile(join(assets, 'pill-fixed.svg')),
    width: 360, height: 120, name: 'pill-fixed.png',
  },
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
