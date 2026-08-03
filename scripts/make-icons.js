/*
 * アプリのアイコンを作る。
 *
 *   npm i -D playwright && node scripts/make-icons.js
 *
 * SVG だけだと、iOS のホーム画面に追加したときに本来のアイコンが出ない
 * (apple-touch-icon は SVG に対応していない)。そのため PNG も用意する。
 * 中身は SVG と同じ絵なので、絵を変えたらこのスクリプトを流し直すこと。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// 4×4 の正方形を 4 つのピースで敷き詰めた絵 = このアプリそのもの
const PIECES = [
  { color: '#ef476f', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { color: '#ffd166', cells: [[2, 0], [3, 0], [3, 1], [3, 2]] },
  { color: '#06d6a0', cells: [[2, 1], [2, 2], [2, 3], [3, 3]] },
  { color: '#4cc9f0', cells: [[0, 2], [1, 2], [0, 3], [1, 3]] }
];

const BG = '#151a2e';
const FRAME = '#3b4788';

/**
 * @param {object} opts
 * @param {number} opts.pad     まわりの余白 (512 基準)
 * @param {number} opts.radius  外枠の角丸 (0 なら四角)
 * @param {boolean} opts.frame  正方形のわくを描くか
 */
function svg(opts) {
  const S = 512;
  const pitch = (S - opts.pad * 2) / 4;
  const gap = pitch * 0.09;
  const tile = pitch - gap;

  let out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"'
    + ' role="img" aria-label="しきつめパズル">\n';
  out += `  <rect width="512" height="512"${opts.radius ? ` rx="${opts.radius}"` : ''} fill="${BG}"/>\n`;
  if (opts.frame) {
    const f = opts.pad - 14;
    out += `  <rect x="${f}" y="${f}" width="${S - f * 2}" height="${S - f * 2}" rx="22"`
      + ` fill="none" stroke="${FRAME}" stroke-width="9"/>\n`;
  }
  for (const piece of PIECES) {
    out += `  <g fill="${piece.color}">\n`;
    for (const [cx, cy] of piece.cells) {
      const x = (opts.pad + cx * pitch + gap / 2).toFixed(1);
      const y = (opts.pad + cy * pitch + gap / 2).toFixed(1);
      out += `    <rect x="${x}" y="${y}" width="${tile.toFixed(1)}" height="${tile.toFixed(1)}"`
        + ` rx="${(tile * 0.16).toFixed(1)}"/>\n`;
    }
    out += '  </g>\n';
  }
  return out + '</svg>\n';
}

// ブラウザのタブなど。角丸あり、わくあり。
const ROUNDED = svg({ pad: 78, radius: 108, frame: true });
// ホーム画面用。まわりを削られても大丈夫なように、余白を広めにして四角のまま。
const FULL_BLEED = svg({ pad: 118, radius: 0, frame: false });

async function main() {
  fs.writeFileSync(path.join(ROOT, 'icon.svg'), ROUNDED);
  fs.writeFileSync(path.join(ROOT, 'icon-maskable.svg'), FULL_BLEED);

  const { chromium } = require('playwright');
  // 手元の Chromium を使いたいときは CHROMIUM_PATH で指定する
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );

  const targets = [
    { source: ROUNDED, size: 192, file: 'icon-192.png' },
    { source: ROUNDED, size: 512, file: 'icon-512.png' },
    { source: FULL_BLEED, size: 512, file: 'icon-maskable-512.png' },
    { source: FULL_BLEED, size: 180, file: 'apple-touch-icon.png' }
  ];

  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1
    });
    await page.setContent(
      '<style>html,body{margin:0;padding:0}svg{display:block;width:100vw;height:100vh}</style>'
      + target.source
    );
    await page.screenshot({ path: path.join(ROOT, target.file) });
    await page.close();
    console.log(target.file, target.size + 'px');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
