/*!
 * puzzle.js — 敷き詰めパズルの問題生成とポリオミノ操作
 *
 * 正方形の盤面を、指定サイズのポリオミノ(ピース)へランダムに分割する。
 * 分割そのものが解答なので、生成された問題は必ず解ける。
 *
 * ブラウザでは <script> で読み込むと window.Puzzle になり、
 * Node からは require() できる。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Puzzle = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 決定的な擬似乱数 (mulberry32)。同じ seed なら同じ問題になる。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ---------------------------------------------------------------- 形の操作

  function sortCells(cells) {
    return cells.slice().sort(function (p, q) {
      return p[1] - q[1] || p[0] - q[0];
    });
  }

  /** 左上を (0,0) に寄せ、順序を正規化する。 */
  function normalize(cells) {
    let minX = Infinity;
    let minY = Infinity;
    for (const c of cells) {
      if (c[0] < minX) minX = c[0];
      if (c[1] < minY) minY = c[1];
    }
    return sortCells(cells.map(function (c) { return [c[0] - minX, c[1] - minY]; }));
  }

  /** 時計回りに 90 度回転。 */
  function rotate(cells) {
    return normalize(cells.map(function (c) { return [-c[1], c[0]]; }));
  }

  /** 左右反転。 */
  function flip(cells) {
    return normalize(cells.map(function (c) { return [-c[0], c[1]]; }));
  }

  function shapeKey(cells) {
    return normalize(cells).map(function (c) { return c[0] + ',' + c[1]; }).join(' ');
  }

  /** 回転・反転で得られる相異なる向きをすべて返す(最大 8 通り)。 */
  function orientations(cells) {
    const out = [];
    const seen = new Set();
    let cur = normalize(cells);
    for (let f = 0; f < 2; f++) {
      for (let r = 0; r < 4; r++) {
        const k = shapeKey(cur);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(cur);
        }
        cur = rotate(cur);
      }
      cur = flip(cur);
    }
    return out;
  }

  /** 回転・反転を同一視したときの代表キー。形の種類を数えるのに使う。 */
  function canonicalKey(cells) {
    return orientations(cells).map(shapeKey).sort()[0];
  }

  function width(cells) {
    let m = 0;
    for (const c of cells) if (c[0] > m) m = c[0];
    return m + 1;
  }

  function height(cells) {
    let m = 0;
    for (const c of cells) if (c[1] > m) m = c[1];
    return m + 1;
  }

  // ---------------------------------------------------------------- 問題生成

  function neighborTable(size) {
    const table = new Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const list = [];
        if (x > 0) list.push(y * size + x - 1);
        if (x < size - 1) list.push(y * size + x + 1);
        if (y > 0) list.push((y - 1) * size + x);
        if (y < size - 1) list.push((y + 1) * size + x);
        table[y * size + x] = list;
      }
    }
    return table;
  }

  /**
   * start を含み、空きマスだけからなる pieceSize マスの連結形をすべて列挙する。
   * start は「残っている空きマスのうち最初のもの」である前提。
   */
  function enumerateShapes(occupied, nb, start, pieceSize) {
    const out = [];
    const seen = new Set();
    const cur = [start];
    const inCur = new Set([start]);

    function rec() {
      if (cur.length === pieceSize) {
        const key = cur.slice().sort(function (a, b) { return a - b; }).join(',');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cur.slice());
        }
        return;
      }
      const cands = [];
      const dup = new Set();
      for (const c of cur) {
        for (const n of nb[c]) {
          if (!occupied[n] && !inCur.has(n) && !dup.has(n)) {
            dup.add(n);
            cands.push(n);
          }
        }
      }
      for (const n of cands) {
        cur.push(n);
        inCur.add(n);
        rec();
        cur.pop();
        inCur.delete(n);
      }
    }

    rec();
    return out;
  }

  /** 空き領域がすべて pieceSize の倍数か(倍数でなければその先で必ず詰む)。 */
  function regionsDivisible(occupied, nb, pieceSize) {
    const n = occupied.length;
    const seen = new Uint8Array(n);
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (occupied[i] || seen[i]) continue;
      let count = 0;
      seen[i] = 1;
      stack.length = 0;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop();
        count++;
        for (const m of nb[c]) {
          if (!occupied[m] && !seen[m]) {
            seen[m] = 1;
            stack.push(m);
          }
        }
      }
      if (count % pieceSize !== 0) return false;
    }
    return true;
  }

  /** 一度だけランダムに分割を試みる。失敗したら null。 */
  function tile(size, pieceSize, rng) {
    const n = size * size;
    const occupied = new Uint8Array(n);
    const nb = neighborTable(size);
    const result = [];
    let budget = 200000;

    function rec() {
      let start = -1;
      for (let i = 0; i < n; i++) {
        if (!occupied[i]) { start = i; break; }
      }
      if (start < 0) return true;

      const shapes = shuffle(enumerateShapes(occupied, nb, start, pieceSize), rng);
      for (const shape of shapes) {
        if (budget-- <= 0) return false;
        for (const c of shape) occupied[c] = 1;
        result.push(shape);
        if (regionsDivisible(occupied, nb, pieceSize) && rec()) return true;
        result.pop();
        for (const c of shape) occupied[c] = 0;
      }
      return false;
    }

    if (!rec()) return null;
    return result.map(function (shape) {
      return sortCells(shape.map(function (i) { return [i % size, Math.floor(i / size)]; }));
    });
  }

  /**
   * 正方形 size×size を pieceSize マスのピースで敷き詰めた問題を作る。
   *
   * @param {number} size      盤面の一辺のマス数
   * @param {number} pieceSize 1 ピースのマス数 (size*size を割り切ること)
   * @param {function} [rng]   0..1 の乱数生成器
   * @param {number} [attempts] 候補を何回生成して一番形が多彩なものを選ぶか
   * @returns {{size:number, pieceSize:number, pieces:Array<Array<[number,number]>>}}
   */
  function generate(size, pieceSize, rng, attempts) {
    if (!Number.isInteger(size) || size < 2) throw new Error('size が不正です: ' + size);
    if (!Number.isInteger(pieceSize) || pieceSize < 1) throw new Error('pieceSize が不正です: ' + pieceSize);
    if ((size * size) % pieceSize !== 0) {
      throw new Error(size + '×' + size + ' は ' + pieceSize + ' マスのピースで割り切れません');
    }
    const random = rng || Math.random;
    const tries = attempts || 6;

    let best = null;
    let bestScore = -1;
    for (let i = 0; i < tries; i++) {
      const pieces = tile(size, pieceSize, random);
      if (!pieces) continue;
      // 同じ形ばかりの問題は退屈なので、形の種類が多い候補を採用する。
      const kinds = new Set(pieces.map(canonicalKey)).size;
      if (kinds > bestScore) {
        bestScore = kinds;
        best = pieces;
      }
      if (kinds === pieces.length) break; // 全部違う形なら文句なし
    }
    if (!best) throw new Error('問題を生成できませんでした');

    return { size: size, pieceSize: pieceSize, pieces: best };
  }

  return {
    mulberry32: mulberry32,
    shuffle: shuffle,
    normalize: normalize,
    rotate: rotate,
    flip: flip,
    shapeKey: shapeKey,
    canonicalKey: canonicalKey,
    orientations: orientations,
    width: width,
    height: height,
    generate: generate
  };
});
