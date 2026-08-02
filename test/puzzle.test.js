const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/puzzle.js');

const LEVELS = [
  { size: 4, pieceSize: 4 },
  { size: 5, pieceSize: 5 },
  { size: 6, pieceSize: 4 },
  { size: 8, pieceSize: 4 },
  { size: 10, pieceSize: 5 }
];

test('normalize は左上寄せして順序を揃える', () => {
  assert.deepStrictEqual(
    P.normalize([[3, 5], [4, 5], [3, 6]]),
    [[0, 0], [1, 0], [0, 1]]
  );
});

test('rotate を 4 回で元に戻る', () => {
  const s = [[0, 0], [1, 0], [2, 0], [2, 1]];
  let c = s;
  for (let i = 0; i < 4; i++) c = P.rotate(c);
  assert.strictEqual(P.shapeKey(c), P.shapeKey(s));
});

test('orientations は形の対称性に応じた数になる', () => {
  const square = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const bar = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const lShape = [[0, 0], [0, 1], [0, 2], [1, 2]];
  assert.strictEqual(P.orientations(square).length, 1);
  assert.strictEqual(P.orientations(bar).length, 2);
  assert.strictEqual(P.orientations(lShape).length, 8);
});

test('canonicalKey は回転・反転しても同じ', () => {
  const s = [[0, 0], [1, 0], [2, 0], [2, 1]];
  assert.strictEqual(P.canonicalKey(s), P.canonicalKey(P.rotate(s)));
  assert.strictEqual(P.canonicalKey(s), P.canonicalKey(P.flip(P.rotate(s))));
});

test('割り切れない組み合わせは拒否する', () => {
  assert.throws(() => P.generate(5, 4, P.mulberry32(1)), /割り切れません/);
});

for (const level of LEVELS) {
  test(`${level.size}×${level.size} / ${level.pieceSize}マス の生成結果が正方形を過不足なく覆う`, () => {
    for (let seed = 1; seed <= 20; seed++) {
      const puz = P.generate(level.size, level.pieceSize, P.mulberry32(seed));
      const total = level.size * level.size;

      assert.strictEqual(puz.pieces.length, total / level.pieceSize);

      const covered = new Set();
      for (const piece of puz.pieces) {
        assert.strictEqual(piece.length, level.pieceSize, 'ピースのマス数');
        for (const [x, y] of piece) {
          assert.ok(x >= 0 && x < level.size && y >= 0 && y < level.size, '盤面の内側');
          const key = x + ',' + y;
          assert.ok(!covered.has(key), `マス ${key} が重複 (seed=${seed})`);
          covered.add(key);
        }
        // 各ピースは連結していること
        const cells = new Set(piece.map(c => c[0] + ',' + c[1]));
        const stack = [piece[0]];
        const seen = new Set([piece[0][0] + ',' + piece[0][1]]);
        while (stack.length) {
          const [x, y] = stack.pop();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const k = (x + dx) + ',' + (y + dy);
            if (cells.has(k) && !seen.has(k)) {
              seen.add(k);
              stack.push([x + dx, y + dy]);
            }
          }
        }
        assert.strictEqual(seen.size, piece.length, 'ピースが連結している');
      }
      assert.strictEqual(covered.size, total, '全マスが覆われている');
    }
  });
}

test('同じ seed なら同じ問題になる', () => {
  const a = P.generate(6, 4, P.mulberry32(42));
  const b = P.generate(6, 4, P.mulberry32(42));
  assert.deepStrictEqual(a.pieces, b.pieces);
});

test('seed が違えば問題も変わる', () => {
  const a = JSON.stringify(P.generate(8, 4, P.mulberry32(1)).pieces);
  const b = JSON.stringify(P.generate(8, 4, P.mulberry32(2)).pieces);
  assert.notStrictEqual(a, b);
});
