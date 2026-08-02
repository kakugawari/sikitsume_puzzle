/*!
 * game.js — しきつめパズルの画面まわり
 */
(function () {
  'use strict';

  const P = window.Puzzle;

  const DIFFICULTIES = [
    { id: 'practice', name: 'れんしゅう', size: 4, pieceSize: 4 },
    { id: 'easy',     name: 'やさしい',   size: 5, pieceSize: 5 },
    { id: 'normal',   name: 'ふつう',     size: 6, pieceSize: 4 },
    { id: 'hard',     name: 'むずかしい', size: 8, pieceSize: 4 },
    { id: 'oni',      name: 'おに',       size: 10, pieceSize: 5 }
  ];

  const COLORS = [
    '#ef476f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#fb8500',
    '#3a86ff', '#ff8fab', '#2ec4b6', '#e07a5f', '#9bc53d', '#f15bb5'
  ];

  const STORE_BEST = 'sikitsume.best.v1';
  const STORE_LAST = 'sikitsume.last.v1';
  const STORE_SAVE = 'sikitsume.save.v1';

  const $ = function (id) { return document.getElementById(id); };

  const els = {
    board: $('board'),
    boardStage: $('boardStage'),
    boardWrap: $('boardWrap'),
    boardPieces: $('boardPieces'),
    ghost: $('ghost'),
    tray: $('tray'),
    dragLayer: $('dragLayer'),
    toast: $('toast'),
    statTime: $('statTime'),
    statLeft: $('statLeft'),
    statBest: $('statBest'),
    difficulty: $('difficulty'),
    winOverlay: $('winOverlay'),
    winTime: $('winTime'),
    winDifficulty: $('winDifficulty'),
    winSub: $('winSub'),
    helpOverlay: $('helpOverlay')
  };

  let state = null;   // 現在のゲーム
  let cell = 32;      // 盤面 1 マスの px
  let trayCell = 22;  // トレイ表示の 1 マスの px
  let drag = null;    // ドラッグ中の情報
  let toastTimer = 0;

  // ------------------------------------------------------------ ちいさな道具

  function storage(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function loadJSON(key, fallback) {
    return storage(function () {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }, fallback);
  }

  function saveJSON(key, value) {
    storage(function () { localStorage.setItem(key, JSON.stringify(value)); });
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 1600);
  }

  function buzz(ms) {
    if (navigator.vibrate) storage(function () { navigator.vibrate(ms); });
  }

  function difficultyOf(id) {
    return DIFFICULTIES.find(function (d) { return d.id === id; }) || DIFFICULTIES[1];
  }

  // ------------------------------------------------------------ ピースの描画

  /** ピースの DOM を作る。size は 1 マスの px。 */
  function pieceEl(piece, size) {
    const cells = piece.cells;
    const filled = new Set(cells.map(function (c) { return c[0] + ',' + c[1]; }));
    const has = function (x, y) { return filled.has(x + ',' + y); };
    const r = Math.max(3, Math.round(size * 0.24));

    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.id = String(piece.id);
    el.style.width = P.width(cells) * size + 'px';
    el.style.height = P.height(cells) * size + 'px';
    el.style.setProperty('--c', piece.color);

    for (const c of cells) {
      const x = c[0];
      const y = c[1];
      const up = has(x, y - 1);
      const down = has(x, y + 1);
      const left = has(x - 1, y);
      const right = has(x + 1, y);

      const i = document.createElement('i');
      i.style.left = x * size + 'px';
      i.style.top = y * size + 'px';
      i.style.width = size + 'px';
      i.style.height = size + 'px';
      i.style.borderRadius =
        (!up && !left ? r : 0) + 'px ' +
        (!up && !right ? r : 0) + 'px ' +
        (!down && !right ? r : 0) + 'px ' +
        (!down && !left ? r : 0) + 'px';
      el.appendChild(i);
    }
    return el;
  }

  // ------------------------------------------------------------ レイアウト

  function layout() {
    if (!state) return;
    const pad = 24;
    const w = els.boardWrap.clientWidth - pad;
    const h = els.boardWrap.clientHeight - pad;
    const size = Math.min(w, h);
    cell = Math.max(16, Math.min(84, Math.floor(size / state.size)));
    trayCell = Math.max(12, Math.min(30, Math.round(cell * 0.68)));

    els.board.style.gridTemplateColumns = 'repeat(' + state.size + ', ' + cell + 'px)';
    els.board.style.gridAutoRows = cell + 'px';
    document.documentElement.style.setProperty('--cell', cell + 'px');
    document.documentElement.style.setProperty('--tray-cell', trayCell + 'px');
  }

  function buildBoard() {
    els.board.textContent = '';
    const total = state.size * state.size;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const c = document.createElement('div');
      c.className = 'bcell';
      frag.appendChild(c);
    }
    els.board.appendChild(frag);
  }

  // ------------------------------------------------------------ ゲーム開始

  function newGame(diffId, seed) {
    const d = difficultyOf(diffId);
    const useSeed = (seed === undefined || seed === null)
      ? (Math.random() * 4294967296) >>> 0
      : seed >>> 0;
    const rng = P.mulberry32(useSeed);
    const puz = P.generate(d.size, d.pieceSize, rng);

    // 解答のピースを、ランダムな向きにしてプレイヤーに渡す
    const pieces = puz.pieces.map(function (solutionCells, index) {
      const canonical = P.normalize(solutionCells);
      const forms = P.orientations(canonical);
      return {
        id: index,
        color: COLORS[index % COLORS.length],
        cells: forms[Math.floor(rng() * forms.length)],
        solutionCells: solutionCells,
        placed: null
      };
    });
    P.shuffle(pieces, rng);
    pieces.forEach(function (p, i) { p.order = i; });

    state = {
      diffId: d.id,
      size: d.size,
      pieceSize: d.pieceSize,
      seed: useSeed,
      pieces: pieces,
      board: new Int16Array(d.size * d.size).fill(-1),
      placedCount: 0,
      selected: null,
      undo: [],
      hints: 0,
      elapsed: 0,
      startedAt: Date.now(),
      won: false
    };

    els.difficulty.value = d.id;
    els.winOverlay.hidden = true;
    saveJSON(STORE_LAST, d.id);
    buildBoard();
    layout();
    render();
    save();
  }

  function pieceById(id) {
    return state.pieces.find(function (p) { return p.id === Number(id); });
  }

  // ------------------------------------------------------------ 盤面の操作

  function canPlace(piece, gx, gy) {
    for (const c of piece.cells) {
      const x = gx + c[0];
      const y = gy + c[1];
      if (x < 0 || y < 0 || x >= state.size || y >= state.size) return false;
      if (state.board[y * state.size + x] !== -1) return false;
    }
    return true;
  }

  function occupy(piece, gx, gy, value) {
    for (const c of piece.cells) {
      state.board[(gy + c[1]) * state.size + (gx + c[0])] = value;
    }
  }

  function place(piece, gx, gy, record) {
    occupy(piece, gx, gy, piece.id);
    piece.placed = { x: gx, y: gy };
    state.placedCount++;
    if (state.selected === piece.id) state.selected = null;
    if (record !== false) {
      state.undo.push({ type: 'place', id: piece.id, x: gx, y: gy, cells: piece.cells });
    }
  }

  function unplace(piece, record) {
    if (!piece.placed) return;
    const at = piece.placed;
    occupy(piece, at.x, at.y, -1);
    piece.placed = null;
    state.placedCount--;
    if (record !== false) {
      state.undo.push({ type: 'remove', id: piece.id, x: at.x, y: at.y, cells: piece.cells });
    }
  }

  function undo() {
    const action = state.undo.pop();
    if (!action) {
      toast('戻せる操作はありません');
      return;
    }
    const piece = pieceById(action.id);
    if (action.type === 'place') {
      unplace(piece, false);
    } else {
      piece.cells = action.cells;
      if (canPlace(piece, action.x, action.y)) {
        place(piece, action.x, action.y, false);
      }
    }
    state.won = false;
    render();
    save();
  }

  function resetBoard() {
    for (const piece of state.pieces) unplace(piece, false);
    state.undo.length = 0;
    state.won = false;
    render();
    save();
  }

  // ------------------------------------------------------------ 向きを変える

  function reorient(piece, transform) {
    if (piece.placed) unplace(piece);
    piece.cells = transform(piece.cells);
    render();
    save();
  }

  function rotateSelected() {
    const piece = state.selected !== null ? pieceById(state.selected) : null;
    if (!piece) { toast('ピースをえらんでね'); return; }
    reorient(piece, P.rotate);
  }

  function flipSelected() {
    const piece = state.selected !== null ? pieceById(state.selected) : null;
    if (!piece) { toast('ピースをえらんでね'); return; }
    reorient(piece, P.flip);
  }

  // ------------------------------------------------------------ ヒント

  function hint() {
    if (state.won) return;

    // 解答の 1 ピース分の領域が、すでに 1 個のピースでぴったり埋まっているか。
    // どのピースもマス数は同じなので、全マスが同じ id なら「ぴったり」で確定する。
    const solvedRegion = function (cells) {
      const id = state.board[cells[0][1] * state.size + cells[0][0]];
      if (id === -1) return false;
      return cells.every(function (c) {
        return state.board[c[1] * state.size + c[0]] === id;
      });
    };

    // 解答のうち、まだ埋まっていないところを探す
    const targets = state.pieces
      .map(function (p) { return p.solutionCells; })
      .filter(function (cells) { return !solvedRegion(cells); });

    if (!targets.length) { toast('もうヒントはありません'); return; }

    // 置く場所が空いている解答ピースを優先する
    const free = targets.find(function (cells) {
      return cells.every(function (c) { return state.board[c[1] * state.size + c[0]] === -1; });
    });
    const target = free || targets[0];

    // ぶつかっているピースをどかす
    for (const c of target) {
      const id = state.board[c[1] * state.size + c[0]];
      if (id !== -1) unplace(pieceById(id));
    }

    const shape = P.normalize(target);
    const key = P.shapeKey(shape);
    const ox = Math.min.apply(null, target.map(function (c) { return c[0]; }));
    const oy = Math.min.apply(null, target.map(function (c) { return c[1]; }));

    const piece = state.pieces.find(function (p) {
      return !p.placed && P.orientations(p.cells).some(function (f) { return P.shapeKey(f) === key; });
    });
    if (!piece) { toast('ヒントを出せませんでした'); return; }

    piece.cells = P.orientations(piece.cells).find(function (f) { return P.shapeKey(f) === key; });
    place(piece, ox, oy);
    state.hints++;
    render();
    save();

    const el = els.boardPieces.querySelector('.piece[data-id="' + piece.id + '"]');
    if (el) el.classList.add('is-hinted');
    buzz(15);
    checkWin();
  }

  // ------------------------------------------------------------ クリア判定

  function checkWin() {
    if (state.won || state.placedCount !== state.pieces.length) return;
    state.won = true;
    state.elapsed = elapsedSeconds();

    const d = difficultyOf(state.diffId);
    const bests = loadJSON(STORE_BEST, {});
    const prev = bests[d.id];
    const isBest = state.hints === 0 && (prev === undefined || state.elapsed < prev);
    if (isBest) {
      bests[d.id] = state.elapsed;
      saveJSON(STORE_BEST, bests);
    }

    els.winDifficulty.textContent = d.name + '（' + d.size + '×' + d.size + '）';
    els.winTime.textContent = formatTime(state.elapsed);
    els.winSub.textContent = isBest
      ? '自己ベスト更新！'
      : (state.hints > 0 ? 'ヒント ' + state.hints + ' 回つかいました' : '');
    els.winOverlay.hidden = false;
    buzz([20, 60, 30]);
    updateStats();
    storage(function () { localStorage.removeItem(STORE_SAVE); });
  }

  // ------------------------------------------------------------ 描画

  function renderTray() {
    els.tray.textContent = '';
    const trayPieces = state.pieces
      .filter(function (p) { return !p.placed; })
      .sort(function (a, b) { return a.order - b.order; });
    for (const piece of trayPieces) {
      const el = pieceEl(piece, trayCell);
      if (state.selected === piece.id) el.classList.add('is-selected');
      els.tray.appendChild(el);
    }
  }

  /** はみ出すならピースを少しずつ小さくして、トレイに全部見えるようにする。 */
  function fitTray() {
    let guard = 0;
    while (els.tray.scrollHeight > els.tray.clientHeight + 1 && trayCell > 12 && guard++ < 14) {
      trayCell = Math.max(12, Math.floor(trayCell * 0.88));
      document.documentElement.style.setProperty('--tray-cell', trayCell + 'px');
      renderTray();
    }
  }

  function render() {
    if (!state) return;

    els.boardPieces.textContent = '';
    for (const piece of state.pieces) {
      if (!piece.placed) continue;
      const el = pieceEl(piece, cell);
      el.classList.add('is-placed');
      el.style.transform = 'translate(' + piece.placed.x * cell + 'px,' + piece.placed.y * cell + 'px)';
      els.boardPieces.appendChild(el);
    }

    renderTray();
    fitTray();
    updateStats();
  }

  function elapsedSeconds() {
    if (!state) return 0;
    if (state.won) return state.elapsed;
    return state.elapsed + (Date.now() - state.startedAt) / 1000;
  }

  function updateStats() {
    if (!state) return;
    els.statTime.textContent = formatTime(elapsedSeconds());
    els.statLeft.textContent = (state.pieces.length - state.placedCount) + ' / ' + state.pieces.length;
    const best = loadJSON(STORE_BEST, {})[state.diffId];
    els.statBest.textContent = best === undefined ? '--:--' : formatTime(best);
  }

  // ------------------------------------------------------------ ドラッグ処理

  function boardRect() {
    return els.board.getBoundingClientRect();
  }

  function onPointerDown(e) {
    if (!state || state.won) return;
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.target.closest ? e.target.closest('.piece') : null;
    if (!el || drag) return;
    const piece = pieceById(el.dataset.id);
    if (!piece) return;

    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const scale = rect.width / (P.width(piece.cells) * cell);

    drag = {
      piece: piece,
      source: el,
      fromBoard: !!piece.placed,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offX: (e.clientX - rect.left) / scale,
      offY: (e.clientY - rect.top) / scale,
      lift: e.pointerType === 'touch' ? cell * 1.1 : 0,
      moving: false,
      float: null,
      fx: 0,
      fy: 0
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function startFloating() {
    const piece = drag.piece;
    drag.moving = true;

    if (drag.fromBoard) {
      unplace(piece);
      render();
    } else {
      drag.source.style.visibility = 'hidden';
    }

    const float = pieceEl(piece, cell);
    float.classList.add('is-dragging');
    els.dragLayer.appendChild(float);
    drag.float = float;
  }

  function onPointerMove(e) {
    if (!drag || (drag.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    if (!drag.moving) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy < 36) return;
      startFloating();
    }
    e.preventDefault();

    drag.fx = e.clientX - drag.offX;
    drag.fy = e.clientY - drag.offY - drag.lift;
    drag.float.style.transform = 'translate(' + drag.fx + 'px,' + drag.fy + 'px)';
    updateGhost();
  }

  function dropTarget() {
    const b = boardRect();
    return {
      x: Math.round((drag.fx - b.left) / cell),
      y: Math.round((drag.fy - b.top) / cell)
    };
  }

  function updateGhost() {
    const piece = drag.piece;
    const target = dropTarget();
    const b = boardRect();
    const nearBoard =
      drag.fx > b.left - cell * 2 && drag.fx < b.right + cell &&
      drag.fy > b.top - cell * 2 && drag.fy < b.bottom + cell;

    els.ghost.textContent = '';
    els.ghost.classList.remove('bad');
    if (!nearBoard) return;

    const ok = canPlace(piece, target.x, target.y);
    els.ghost.style.color = piece.color;
    if (!ok) els.ghost.classList.add('bad');

    for (const c of piece.cells) {
      const x = target.x + c[0];
      const y = target.y + c[1];
      if (x < 0 || y < 0 || x >= state.size || y >= state.size) continue;
      const g = document.createElement('div');
      g.className = 'gcell';
      g.style.left = x * cell + 'px';
      g.style.top = y * cell + 'px';
      g.style.width = cell + 'px';
      g.style.height = cell + 'px';
      els.ghost.appendChild(g);
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    const piece = drag.piece;
    const wasMoving = drag.moving;
    const fromBoard = drag.fromBoard;

    if (drag.float) drag.float.remove();
    if (drag.source) drag.source.style.visibility = '';
    els.ghost.textContent = '';
    els.ghost.classList.remove('bad');

    let placedNow = false;
    if (wasMoving) {
      const target = dropTarget();
      if (canPlace(piece, target.x, target.y)) {
        place(piece, target.x, target.y);
        placedNow = true;
        buzz(12);
      } else if (fromBoard) {
        // 盤外へ持ち出した = 手もとに戻す
        buzz(8);
      }
      state.selected = null;
    } else if (e.type !== 'pointercancel') {
      // 動かさずに離した = タップ
      if (fromBoard) {
        unplace(piece);
        state.selected = piece.id;
      } else if (state.selected === piece.id) {
        piece.cells = P.rotate(piece.cells);
      } else {
        state.selected = piece.id;
      }
    }

    drag = null;
    render();
    save();

    if (placedNow) {
      const el = els.boardPieces.querySelector('.piece[data-id="' + piece.id + '"]');
      if (el) el.classList.add('just-placed');
      checkWin();
    }
  }

  // ------------------------------------------------------------ 途中経過の保存

  function save() {
    if (!state) return;
    if (state.won) return;
    saveJSON(STORE_SAVE, {
      diffId: state.diffId,
      seed: state.seed,
      elapsed: elapsedSeconds(),
      hints: state.hints,
      pieces: state.pieces.map(function (p) {
        return { id: p.id, c: p.cells, p: p.placed };
      })
    });
  }

  function restore() {
    const data = loadJSON(STORE_SAVE, null);
    if (!data || !data.pieces || !difficultyOf(data.diffId)) return false;
    try {
      newGame(data.diffId, data.seed);
      for (const saved of data.pieces) {
        const piece = pieceById(saved.id);
        if (!piece) continue;
        piece.cells = saved.c.map(function (c) { return [c[0], c[1]]; });
      }
      for (const saved of data.pieces) {
        if (!saved.p) continue;
        const piece = pieceById(saved.id);
        if (piece && canPlace(piece, saved.p.x, saved.p.y)) place(piece, saved.p.x, saved.p.y, false);
      }
      state.elapsed = Number(data.elapsed) || 0;
      state.hints = Number(data.hints) || 0;
      state.startedAt = Date.now();
      render();
      return true;
    } catch (err) {
      return false;
    }
  }

  // ------------------------------------------------------------ 起動

  function setupUI() {
    for (const d of DIFFICULTIES) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + '  ' + d.size + '×' + d.size + '（' + d.pieceSize + 'マス × ' +
        (d.size * d.size / d.pieceSize) + '）';
      els.difficulty.appendChild(opt);
    }

    els.difficulty.addEventListener('change', function () { newGame(els.difficulty.value); });
    $('btnNew').addEventListener('click', function () { newGame(state.diffId); });
    $('btnRotate').addEventListener('click', rotateSelected);
    $('btnFlip').addEventListener('click', flipSelected);
    $('btnUndo').addEventListener('click', undo);
    $('btnHint').addEventListener('click', hint);
    $('btnReset').addEventListener('click', resetBoard);
    $('btnHelp').addEventListener('click', function () { els.helpOverlay.hidden = false; });
    $('btnHelpClose').addEventListener('click', function () { els.helpOverlay.hidden = true; });
    $('btnNext').addEventListener('click', function () {
      els.winOverlay.hidden = true;
      newGame(state.diffId);
    });
    $('btnStay').addEventListener('click', function () { els.winOverlay.hidden = true; });

    els.tray.addEventListener('pointerdown', onPointerDown);
    els.boardPieces.addEventListener('pointerdown', onPointerDown);

    // 盤面の何もないところをタップしたら選択解除
    els.board.addEventListener('pointerdown', function () {
      if (state && state.selected !== null) {
        state.selected = null;
        render();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'r') rotateSelected();
      else if (key === 'f') flipSelected();
      else if (key === 'u') undo();
      else if (key === 'h') hint();
      else if (key === 'n') newGame(state.diffId);
      else if (key === 'escape') {
        els.helpOverlay.hidden = true;
        els.winOverlay.hidden = true;
        if (state) { state.selected = null; render(); }
      } else return;
      e.preventDefault();
    });

    let resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { layout(); render(); }, 120);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) save();
    });

    // 画面のピンチズームや長押しメニューを抑える
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('.piece')) e.preventDefault();
    });

    setInterval(function () {
      if (state && !state.won) updateStats();
    }, 500);
    setInterval(save, 5000);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 無視 */ });
    });
  }

  function main() {
    setupUI();
    if (!restore()) newGame(loadJSON(STORE_LAST, 'easy'));
    registerServiceWorker();

    // 自動テストから盤面をのぞくための入口
    window.__sikitsume = {
      state: function () { return state; },
      cellSize: function () { return cell; },
      canPlace: canPlace,
      newGame: newGame
    };
  }

  main();
})();
