// One-off renderer for the logo concept SVGs. Produces 512x512 PNGs of each
// concept in assets/concepts/ alongside the source SVGs.
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'assets', 'concepts');

const files = (await readdir(dir)).filter((f) => f.endsWith('.svg'));
for (const file of files) {
  const svg = await readFile(join(dir, file));
  const out = join(dir, file.replace(/\.svg$/, '.png'));
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(out);
  console.log(`  ${file.replace('.svg', '.png')}  512x512`);
}
console.log(`\nDone. ${files.length} PNGs written.`);
