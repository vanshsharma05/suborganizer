#!/usr/bin/env node
/**
 * Turns iPhone captures into App Store screenshots.
 *
 * The problem this solves: App Store Connect wants 1284x2778 (the 6.5" slot)
 * and an iPhone SE 2 captures at 750x1334. Those are different aspect ratios —
 * 9:16 against roughly 9:19.5 — so a plain resize either stretches the app or
 * crops the top and bottom off it. Neither is acceptable, and Apple validates
 * the pixel dimensions exactly.
 *
 * So the capture is scaled to the full width, kept at its own aspect ratio, and
 * centred on a brand-coloured canvas of the required size. The bands above and
 * below read as a deliberate frame rather than as letterboxing, which is how a
 * good many apps on the store present theirs.
 *
 * Usage:
 *   node scripts/store-screenshots.js <in-dir> [out-dir]
 *
 * Every .png and .jpg in <in-dir> is converted, in filename order, so name them
 * 1-home.png, 2-checkin.png and so on to fix the order they appear in.
 */

const fs = require('node:fs');
const path = require('node:path');
const Jimp = require('jimp-compact');

// The 6.5" slot, which is what this app record asks for. Apple scales this down
// for every smaller iPhone, so one set covers the listing.
const W = 1284;
const H = 2778;

// theme.color.brand. The screenshots then match the app's own coral rather than
// sitting on a grey nobody chose.
const BG = 0xe87a5dff;

const inDir = process.argv[2];
const outDir = process.argv[3] ?? path.join(inDir ?? '.', 'store');

if (!inDir) {
  console.error('Usage: node scripts/store-screenshots.js <in-dir> [out-dir]');
  process.exit(2);
}

const files = fs
  .readdirSync(inDir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort();

if (!files.length) {
  console.error(`No .png or .jpg found in ${inDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const [i, file] of files.entries()) {
    const shot = await Jimp.read(path.join(inDir, file));
    const scaled = shot.clone().resize(W, Jimp.AUTO);

    if (scaled.bitmap.height > H) {
      // A capture taller than the canvas once widened — a modern iPhone rather
      // than an SE. Fit by height instead and let it sit narrower.
      scaled.resize(Jimp.AUTO, H);
    }

    const canvas = new Jimp(W, H, BG);
    canvas.composite(
      scaled,
      Math.round((W - scaled.bitmap.width) / 2),
      Math.round((H - scaled.bitmap.height) / 2),
    );

    const out = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${path.parse(file).name}.png`);
    await canvas.writeAsync(out);
    console.log(`  ${file}  ${shot.bitmap.width}x${shot.bitmap.height}  ->  ${W}x${H}`);
  }

  console.log(`\n${files.length} screenshot${files.length === 1 ? '' : 's'} written to ${outDir}`);
})();
