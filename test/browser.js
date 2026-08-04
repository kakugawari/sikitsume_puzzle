/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指やマウスの操作をそのまま再現して確かめる。
 * 過去に踏んだ不具合には、それぞれ見張り役のテストを置いてある。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const CHROMIUM = process.env.CHROMIUM_PATH;

let failed = 0;
let passed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

// ---------------------------------------------------------------- 部品

/** 指でドラッグしてピースを置く(掴んだマスが行き先にくるようにする)。 */
async function dragPieceTo(page, spec) {
  return page.evaluate(async ({ minX, minY }) => {
    const S = window.__sikitsume;
    const st = S.state();
    const cell = S.cellSize();
    const piece = st.pieces.find((q) => !q.placed);
    let spot = null;
    for (let y = minY; y < st.size && !spot; y++) {
      for (let x = minX; x < st.size && !spot; x++) {
        if (S.canPlace(piece, x, y)) spot = { x, y };
      }
    }
    if (!spot) return null;

    const el = document.querySelector(`#tray .piece[data-id="${piece.id}"] i`);
    const from = el.getBoundingClientRect();
    const board = document.getElementById('board').getBoundingClientRect();
    const first = piece.cells[0];
    const lift = cell * 1.1;   // 指の少し上にピースを持ち上げている
    const to = {
      x: board.left + (spot.x + first[0] + 0.5) * cell,
      y: board.top + (spot.y + first[1] + 0.5) * cell + lift
    };
    const ev = (type, x, y, node) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true
    }));

    ev('pointerdown', from.left + from.width / 2, from.top + from.height / 2, el);
    ev('pointermove', from.left + 30, from.top - 30, window);
    ev('pointermove', to.x, to.y, window);
    const ghost = document.querySelectorAll('#ghost .gcell').length;
    ev('pointerup', to.x, to.y, window);

    // 置いた直後の見た目を数フレーム記録する
    const want = { x: board.left + spot.x * cell, y: board.top + spot.y * cell };
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const node = document.querySelector(`#boardPieces .piece[data-id="${piece.id}"]`);
      if (!node) { worst = Infinity; continue; }
      const box = node.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(box.left - want.x), Math.abs(box.top - want.y));
    }
    return { spot, placed: S.state().pieces.find((q) => q.id === piece.id).placed, ghost, worst: Math.round(worst) };
  }, spec);
}

function trayBoxes(page) {
  return page.evaluate(() => {
    const out = {};
    for (const slot of document.querySelectorAll('#tray .slot')) {
      const r = slot.getBoundingClientRect();
      out[slot.dataset.id] = [Math.round(r.left), Math.round(r.top), Math.round(r.width)];
    }
    return out;
  });
}

// ---------------------------------------------------------------- 本体

async function run() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    const { devices } = require('playwright');
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__sikitsume);

    // ------------------------------------------------ 遊べること
    section('遊べること (スマホ)');
    await phone.evaluate(() => window.__sikitsume.newGame('normal'));
    await phone.waitForTimeout(250);
    ok(await phone.locator('#tray .slot').count() === 9, '6×6 は 9 ピースで始まる');

    const drag = await dragPieceTo(phone, { minX: 2, minY: 2 });
    ok(drag && drag.ghost > 0, 'ドラッグ中に落ちる場所が見える');
    ok(drag && drag.placed && drag.placed.x === drag.spot.x && drag.placed.y === drag.spot.y,
      `指でドラッグした場所に置ける (${drag && drag.spot.x},${drag && drag.spot.y})`);
    // 置いた瞬間にピースが盤面の左上へ飛んだことがあるので見張る
    ok(drag && drag.worst < 12, `置いた直後にピースが飛ばない (最大ずれ ${drag && drag.worst}px)`);
    ok(await phone.locator('#tray .slot').count() === 8, 'トレイから 1 つ減る');

    await phone.locator('#boardPieces .piece i').first().tap();
    await phone.waitForTimeout(120);
    ok(await phone.evaluate(() => window.__sikitsume.state().placedCount) === 0,
      '盤面のピースをタップすると手もとに戻る');

    // ------------------------------------------------ 選ぶ・まわす
    section('選ぶ・まわす');
    const id = await phone.evaluate(() => {
      window.__sikitsume.state().selected = null;
      return document.querySelector('#tray .slot').dataset.id;
    });
    const cellsOf = () => phone.evaluate((i) => JSON.stringify(
      window.__sikitsume.state().pieces.find((p) => p.id === Number(i)).cells), id);

    const beforeCells = await cellsOf();
    await phone.locator(`#tray .slot[data-id="${id}"]`).tap();
    await phone.waitForTimeout(120);
    ok(await phone.evaluate(() => window.__sikitsume.state().selected) === Number(id), 'タップで選ばれる');
    ok(await cellsOf() === beforeCells, '選んだだけでは向きは変わらない');

    const look = await phone.evaluate((i) => {
      const sel = document.querySelector(`#tray .slot[data-id="${i}"]`);
      const other = [...document.querySelectorAll('#tray .slot')].find((s) => s.dataset.id !== i);
      return {
        selShadow: getComputedStyle(sel).boxShadow,
        otherShadow: other ? getComputedStyle(other).boxShadow : '',
        tint: Number(getComputedStyle(sel, '::before').opacity),
        armed: document.getElementById('btnRotate').classList.contains('is-armed'),
        enabled: !document.getElementById('btnRotate').disabled
      };
    }, id);
    ok(look.selShadow !== 'none' && look.selShadow !== look.otherShadow, '選んだピースのわくが光る');
    ok(look.tint > 0.1, `選んだピースに色がつく (不透明度 ${look.tint})`);
    ok(look.armed && look.enabled, '回転ボタンが押せる状態になる');

    // まわすたびに並びが変わると、指の下からピースが逃げてしまう
    const boxesBefore = await trayBoxes(phone);
    let moved = 0;
    for (let i = 0; i < 4; i++) {
      await phone.locator(`#tray .slot[data-id="${id}"]`).tap();
      await phone.waitForTimeout(220);
      const now = await trayBoxes(phone);
      for (const key of Object.keys(boxesBefore)) {
        if (!now[key] || now[key].join() !== boxesBefore[key].join()) moved++;
      }
    }
    ok(moved === 0, '4 回まわしてもトレイのピースが 1 つも動かない');
    const expected = await phone.evaluate((c) => JSON.stringify(
      window.Puzzle.orientations(JSON.parse(c)).length === 1
        ? JSON.parse(c)
        : window.Puzzle.rotate(window.Puzzle.rotate(window.Puzzle.rotate(window.Puzzle.rotate(JSON.parse(c)))))
    ), beforeCells);
    ok(await cellsOf() === expected, '4 回まわすと元の向きに戻る');

    const anim = await phone.evaluate(async (i) => {
      window.__sikitsume.state().selected = Number(i);
      document.getElementById('btnFlip').click();
      const frames = [];
      for (let n = 0; n < 12; n++) {
        await new Promise((r) => requestAnimationFrame(r));
        const el = document.querySelector(`#tray .slot[data-id="${i}"] .piece`);
        frames.push(el ? getComputedStyle(el).transform : 'なし');
      }
      return { first: frames[0], last: frames[frames.length - 1], steps: new Set(frames).size };
    }, id);
    ok(anim.first !== 'none' && anim.steps >= 3, `反転が動いて見える (${anim.steps} 段階)`);
    ok(anim.last === 'none', '反転しおわると正しい向きで止まる');

    await phone.evaluate(() => {
      const cells = document.querySelectorAll('#board .bcell');
      const c = cells[Math.floor(cells.length / 2)];
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true
      }));
    });
    await phone.waitForTimeout(120);
    ok(await phone.evaluate(() => window.__sikitsume.state().selected === null),
      '盤面の空きマスをタップすると選択が外れる');

    // ------------------------------------------------ ヒント
    section('ヒント');
    const stuck = await phone.evaluate(() => {
      const S = window.__sikitsume;
      const bad = [];
      for (const diff of ['practice', 'easy', 'normal', 'hard', 'oni']) {
        for (let seed = 1; seed <= 5; seed++) {
          S.newGame(diff, seed);
          const st = S.state();
          // 半分を、向きも場所もでたらめに置いてしまう
          let rnd = seed * 2654435761 % 4294967296;
          const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
          for (const piece of st.pieces.slice(0, Math.ceil(st.pieces.length / 2))) {
            const forms = window.Puzzle.orientations(piece.cells);
            piece.cells = forms[Math.floor(rand() * forms.length)];
            const spots = [];
            for (let y = 0; y < st.size; y++) {
              for (let x = 0; x < st.size; x++) if (S.canPlace(piece, x, y)) spots.push([x, y]);
            }
            if (spots.length) {
              const q = spots[Math.floor(rand() * spots.length)];
              S.place(piece, q[0], q[1]);
            }
          }
          let clicks = 0;
          const limit = st.pieces.length * 3;
          while (!S.state().won && clicks < limit) { S.hint(); clicks++; }
          if (!S.state().won) bad.push(`${diff}/${seed}`);
        }
      }
      return bad;
    });
    ok(stuck.length === 0,
      `でたらめに置いた状態からでも、ヒントだけで必ず最後まで解ける (25 局面${stuck.length ? ': ' + stuck.join(', ') : ''})`);

    // ------------------------------------------------ 画面の収まり
    // 開いた直後、盤面が上下のバーに重なっていたことがある。
    // 原因はトレイを描く前に高さを測っていたこと (トレイが伸びると盤面がはみ出す)。
    section('画面の収まり');
    const boxes = () => phone.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, height: b.height };
      };
      return {
        diff: window.__sikitsume.state().diffId,
        cell: window.__sikitsume.cellSize(),
        board: r('#board'),
        topbar: r('#topbar'),
        toolbar: r('.tray-bar'),
        room: document.getElementById('boardWrap').clientHeight - 24,
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        trayOver: document.getElementById('tray').scrollHeight - document.getElementById('tray').clientHeight
      };
    });

    for (const diff of ['practice', 'easy', 'normal', 'hard', 'oni']) {
      for (const how of ['切り替え', '開き直し']) {
        await phone.evaluate((d) => window.__sikitsume.newGame(d), diff);
        await phone.waitForTimeout(250);
        if (how === '開き直し') {
          // アプリを閉じて開き直した状態 (この経路で盤面がはみ出していた)
          await phone.evaluate(() => window.dispatchEvent(new Event('pagehide')));
          await phone.goto(URL);
          await phone.waitForFunction(() => window.__sikitsume);
          await phone.waitForTimeout(300);
        }
        const m = await boxes();
        const overTop = Math.round(m.topbar.bottom - m.board.top);
        const overBottom = Math.round(m.board.bottom - m.toolbar.top);
        ok(overTop <= 0 && overBottom <= 0,
          `${m.diff}/${how}: 盤面が上下のバーに重ならない` +
          (overTop > 0 || overBottom > 0 ? ` (上${Math.max(0, overTop)}px 下${Math.max(0, overBottom)}px)` : ''));
        ok(m.wide <= 1, `${m.diff}/${how}: 横スクロールが出ない`);
        ok(m.trayOver <= 0, `${m.diff}/${how}: ピースがトレイに収まる`);
        // 小さすぎても遊びにくいので、使える場所の 8 割は使えていること
        ok(m.board.height >= m.room * 0.8,
          `${m.diff}/${how}: 盤面が場所を活かせている (${Math.round(m.board.height)}px / ${m.room}px)`);
      }
    }

    // ------------------------------------------------ 続きから
    section('続きから遊べる');
    await phone.evaluate(() => window.__sikitsume.newGame('hard'));
    await phone.waitForTimeout(200);
    await phone.click('#btnHint');
    await phone.waitForTimeout(150);
    const seed = await phone.evaluate(() => window.__sikitsume.state().seed);
    await phone.reload();
    await phone.waitForFunction(() => window.__sikitsume);
    const back = await phone.evaluate(() => {
      const st = window.__sikitsume.state();
      return { seed: st.seed, placed: st.placedCount, diff: st.diffId };
    });
    ok(back.seed === seed && back.placed === 1 && back.diff === 'hard',
      'リロードしても同じ問題の続きから遊べる');

    // ------------------------------------------------ タイムとベスト
    // クリア時間が必ず 0 秒として記録される不具合があった
    // (won を立ててから経過時間を求めていたため)。
    section('タイムとベスト');
    await phone.evaluate(() => {
      localStorage.clear();
      // 壊れた記録が残っている端末を想定して入れておく
      localStorage.setItem('sikitsume.best.v1', JSON.stringify({ practice: 0 }));
    });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__sikitsume);
    await phone.evaluate(() => window.__sikitsume.newGame('practice'));
    await phone.waitForTimeout(250);
    ok(await phone.textContent('#statBest') === '--:--', '0 秒という記録は無かったことにする');

    // ヒントを使わずに、最後の 1 つ以外を正解の位置に置く
    await phone.evaluate(() => {
      const S = window.__sikitsume;
      const st = S.state();
      for (const piece of st.pieces.slice(0, st.pieces.length - 1)) {
        const cells = piece.solutionCells;
        const key = window.Puzzle.shapeKey(window.Puzzle.normalize(cells));
        piece.cells = window.Puzzle.orientations(piece.cells).find((f) => window.Puzzle.shapeKey(f) === key);
        S.place(piece, Math.min.apply(null, cells.map((c) => c[0])), Math.min.apply(null, cells.map((c) => c[1])));
      }
    });
    await phone.waitForTimeout(1800);   // ここが「かかった時間」になる
    const cleared = await phone.evaluate(() => {
      const S = window.__sikitsume;
      const st = S.state();
      const piece = st.pieces.find((q) => !q.placed);
      const cells = piece.solutionCells;
      const key = window.Puzzle.shapeKey(window.Puzzle.normalize(cells));
      piece.cells = window.Puzzle.orientations(piece.cells).find((f) => window.Puzzle.shapeKey(f) === key);
      const cell = S.cellSize();
      const board = document.getElementById('board').getBoundingClientRect();
      const gx = Math.min.apply(null, cells.map((c) => c[0]));
      const gy = Math.min.apply(null, cells.map((c) => c[1]));
      const el = document.querySelector(`#tray .piece[data-id="${piece.id}"] i`);
      const from = el.getBoundingClientRect();
      const c0 = piece.cells[0];
      const ev = (t, x, y, n) => n.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true,
        clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true }));
      const tx = board.left + (gx + c0[0] + 0.5) * cell;
      const ty = board.top + (gy + c0[1] + 0.5) * cell + cell * 1.1;
      ev('pointerdown', from.left + from.width / 2, from.top + from.height / 2, el);
      ev('pointermove', from.left + 20, from.top - 20, window);
      ev('pointermove', tx, ty, window);
      ev('pointerup', tx, ty, window);
      return {
        won: S.state().won,
        elapsed: S.state().elapsed,
        hints: S.state().hints,
        shown: document.getElementById('winTime').textContent,
        best: JSON.parse(localStorage.getItem('sikitsume.best.v1') || '{}').practice
      };
    });
    ok(cleared.won, '最後の 1 つを置くとクリアになる');
    ok(cleared.elapsed >= 1.5, `かかった時間が記録される (${(cleared.elapsed || 0).toFixed(1)} 秒)`);
    ok(cleared.shown !== '0:00', `クリア画面のタイムが 0:00 でない (${cleared.shown})`);
    ok(cleared.best >= 1.5, `ベストに正しい時間が残る (${cleared.best})`);
    await phone.evaluate(() => { document.getElementById('btnStay').click(); });

    // ------------------------------------------------ アイコン
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const head = await desk.evaluate(() => ({
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      icons: [...document.querySelectorAll('link[rel="icon"]')].map((l) => l.getAttribute('href'))
    }));
    // iOS は SVG のアイコンを使えない
    ok(!!head.apple && head.apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${head.apple})`);
    const manifest = await (await desk.request.get(URL + 'manifest.webmanifest')).json();
    for (const src of [...new Set([...head.icons, head.apple, ...manifest.icons.map((i) => i.src)])]) {
      const res = await desk.request.get(URL + src.replace('./', ''));
      ok(res.ok(), `${src} が配信される`);
    }
    ok(manifest.icons.some((i) => i.purpose === 'maskable' && i.type === 'image/png'),
      'まわりを削られる形式 (maskable) の PNG がある');

    // ------------------------------------------------ 更新とオフライン
    section('更新とオフライン');
    const swCtx = await browser.newContext();
    const swPage = await swCtx.newPage();
    await swPage.goto(URL);
    await swPage.waitForFunction(() => window.__sikitsume);
    ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
      'サービスワーカーが動く');
    await swPage.waitForTimeout(800);

    const fs = require('node:fs');
    const indexPath = path.join(__dirname, '..', 'index.html');
    const original = fs.readFileSync(indexPath, 'utf8');
    const marker = '<h1 class="title">しきつめパズル</h1>';
    fs.writeFileSync(indexPath, original.replace(marker, '<h1 class="title">こうしんかくにん</h1>'));
    await swPage.reload();
    await swPage.waitForTimeout(400);
    const title = await swPage.textContent('.title');
    fs.writeFileSync(indexPath, original);
    ok(title === 'こうしんかくにん', `直したものが 1 回のリロードで出る (見出し: ${title})`);

    await swPage.reload();
    await swPage.waitForTimeout(500);
    await swCtx.setOffline(true);
    await swPage.reload().catch(() => {});
    await swPage.waitForTimeout(400);
    ok(await swPage.evaluate(() => !!window.__sikitsume && document.querySelectorAll('#tray .slot').length > 0)
      .catch(() => false), 'ネットにつながらなくても遊べる');
    await swCtx.setOffline(false);

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
