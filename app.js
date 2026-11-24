/* 算法领地争夺战 · UI 与渲染 */
(function () {
  'use strict';

  const C = window.TerritoryCore;
  if (!C) throw new Error('core.js 未加载');

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const SIZES = [25, 31, 41, 51];
  const SPEEDS = [1, 2, 4, 8];
  const UI_DEFAULT = ['flood', 'bidastar', 'dfs', 'astar'];

  const state = {
    arena: null,
    match: null,
    selected: UI_DEFAULT.slice(),
    size: 31,
    braid: 45,
    speed: 2,
    seed: '20261124',
    running: false,
    snapshot: false,
    snapshotRequested: false,
    snapshotTicks: 210,
    autoplay: true,
    acc: 0,
    uiAcc: 0,
    lastTs: 0,
    dirty: true,
    cards: new Map(),
    lastOrder: '',
    hover: null,
    focusAgent: null,
    geom: null,
    cw: 0,
    ch: 0,
    dpr: 1,
    baseCanvas: null,
    baseCtx: null,
    wallPath: null,
    boardPath: null,
    resizeRaf: 0,
    toastTimer: 0,
    reportOpen: false
  };

  const el = {};
  const canvas = $('arena');
  const ctx = canvas.getContext('2d');
  const shell = $('canvasShell');
  const board = $('board');
  const algoGrid = $('algoGrid');
  const cellTip = $('cellTip');
  const toastEl = $('toast');

  function pick(value, allowed, fallback) {
    return allowed.includes(Number(value)) ? Number(value) : fallback;
  }

  function readParams() {
    state.size = pick(params.get('size'), SIZES, 31);
    state.braid = Math.max(0, Math.min(100, Number(params.get('braid') || 45)));
    state.speed = pick(params.get('speed'), SPEEDS, 2);
    if (params.get('seed')) state.seed = params.get('seed').slice(0, 40);
    if (params.get('autoplay') === '0') state.autoplay = false;
    if (params.get('snapshot') === '1') {
      state.snapshotRequested = true;
      state.snapshotTicks = Math.max(0, Math.min(2000, Number(params.get('ticks') || 210)));
    }
    const algos = (params.get('algos') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (algos.length >= 2) {
      const known = algos.filter(id => C.ALGORITHMS.some(a => a.id === id));
      if (known.length >= 2 && known.length <= 8) state.selected = Array.from(new Set(known));
    }
  }

  function randomSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return String(10000000 + (buf[0] % 90000000));
    }
    return String(Math.floor(10000000 + Math.random() * 90000000));
  }

  function setSeg(container, attr, value) {
    if (!container) return;
    for (const btn of container.querySelectorAll('button')) {
      btn.classList.toggle('on', Number(btn.dataset[attr]) === Number(value));
    }
  }

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function mix(hex, target, amount) {
    const a = hexToRgb(hex), b = hexToRgb(target || '#ffffff');
    const lerp = (x, y) => Math.round(x + (y - x) * amount);
    return `rgb(${lerp(a[0], b[0])},${lerp(a[1], b[1])},${lerp(a[2], b[2])})`;
  }

  function algorithmMeta(id) {
    return C.ALGORITHMS.find(a => a.id === id);
  }

  function syncMeta() {
    el.metaSize.textContent = `${state.size} × ${state.size}`;
    el.metaSeed.textContent = String(state.seed);
    el.metaAgents.textContent = String(state.selected.length);
    el.seedReadout.textContent = `#${state.seed}`;
    el.stageTitle.textContent = titleFor(state.selected.length);
  }

  function titleFor(count) {
    if (count === 2) return '双雄割据，寸土必争';
    if (count === 3) return '三方割据，寸土必争';
    if (count === 4) return '四方割据，寸土必争';
    if (count >= 8) return '八强割据，寸土不留';
    return `${count} 方割据，寸土必争`;
  }

  function buildAlgoChips() {
    algoGrid.innerHTML = '';
    for (const meta of C.ALGORITHMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'algo-chip' + (state.selected.includes(meta.id) ? ' selected' : '');
      btn.dataset.id = meta.id;
      btn.style.setProperty('--accent', meta.color);
      btn.setAttribute('aria-pressed', state.selected.includes(meta.id) ? 'true' : 'false');
      btn.innerHTML = `<span class="chip-dot"></span><span class="chip-name">${meta.name}</span><span class="chip-tag">${meta.budget > 1 ? meta.budget + '×' : meta.id === 'dfs' ? 'DEEP' : meta.id === 'dijkstra' ? 'COST' : 'SEARCH'}</span>`;
      btn.title = `${meta.name} · ${meta.tagline}`;
      btn.addEventListener('click', () => toggleAlgorithm(meta.id));
      algoGrid.appendChild(btn);
    }
    updatePickCount();
  }

  function updatePickCount() {
    el.pickCount.textContent = `${state.selected.length} / 8`;
    const chips = algoGrid.querySelectorAll('.algo-chip');
    for (const chip of chips) {
      const on = state.selected.includes(chip.dataset.id);
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function toggleAlgorithm(id) {
    const at = state.selected.indexOf(id);
    if (at >= 0) {
      if (state.selected.length <= 2) { toast('至少要保留 2 个算法参赛喵'); return; }
      state.selected.splice(at, 1);
    } else {
      if (state.selected.length >= 8) { toast('最多支持 8 个算法，已经满员了喵'); return; }
      state.selected.push(id);
    }
    updatePickCount();
    el.btnApply.classList.add('attention');
  }

  function buildBoard() {
    board.innerHTML = '';
    state.cards.clear();
    state.lastOrder = '';
    for (const id of state.selected) {
      const meta = algorithmMeta(id);
      if (!meta) continue;
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.dataset.id = id;
      card.style.setProperty('--accent', meta.color);
      card.innerHTML = `
        <div class="agent-top">
          <span class="agent-rank">--</span>
          <span class="algo-dot" style="background:${meta.color}"></span>
          <span class="agent-name">${meta.name}</span>
          <span class="agent-pct">0.0%</span>
        </div>
        <div class="agent-bar"><i></i></div>
        <div class="agent-sub"><span class="agent-cells">0 格</span><span class="agent-status">等待</span></div>`;
      card.addEventListener('mouseenter', () => setFocus(id));
      card.addEventListener('mouseleave', () => setFocus(null));
      state.cards.set(id, card);
      board.appendChild(card);
    }
  }

  function setFocus(id) {
    if (state.focusAgent === id) return;
    state.focusAgent = id;
    state.dirty = true;
  }

  function createNewMap(seed) {
    state.seed = String(seed == null ? state.seed : seed).trim() || randomSeed();
    state.arena = C.generateArena({
      cols: state.size,
      rows: state.size,
      seed: state.seed,
      braid: state.braid,
      rooms: 5
    });
    state.match = C.createMatch(state.arena, state.selected, state.seed + ':match');
    state.snapshot = false;
    state.running = true;
    state.acc = 0;
    state.lastTs = performance.now();
    state.hover = null;
    state.focusAgent = null;
    state.lastOrder = '';
    buildBoard();
    syncMeta();
    measureCanvas();
    buildStatic();
    updateUI(true);
    updatePauseButton();
    renderCanvas();
  }

  function restartSameMap() {
    if (!state.arena || !state.match) { createNewMap(state.seed); return; }
    state.match = C.createMatch(state.arena, state.selected, state.seed + ':match');
    state.snapshot = false;
    state.running = true;
    state.acc = 0;
    state.lastTs = performance.now();
    state.hover = null;
    state.focusAgent = null;
    state.lastOrder = '';
    updateUI(true);
    updatePauseButton();
    renderCanvas();
  }

  function applySelection() {
    if (state.selected.length < 2) { toast('至少选 2 个算法喵'); return; }
    if (state.selected.length > 8) { toast('最多 8 个算法喵'); return; }
    el.btnApply.classList.remove('attention');
    if (state.arena) {
      state.match = C.createMatch(state.arena, state.selected, state.seed + ':match');
      state.snapshot = false;
      state.running = true;
      state.acc = 0;
      state.lastTs = performance.now();
      state.hover = null;
      state.focusAgent = null;
      state.lastOrder = '';
      buildBoard();
      syncMeta();
      updateUI(true);
      updatePauseButton();
      renderCanvas();
      toast('阵容已更新，重新开抢喵');
    } else {
      createNewMap(state.seed);
    }
  }

  function setRunning(value) {
    if (!state.match) return;
    if (state.match.over || state.snapshot) return;
    state.running = !!value;
    state.acc = 0;
    state.lastTs = performance.now();
    updatePauseButton();
    updateUI(true);
  }

  function togglePause() {
    if (!state.match) return;
    if (state.match.over) { restartSameMap(); return; }
    if (state.snapshot) return;
    setRunning(!state.running);
  }

  function updatePauseButton() {
    if (!el.btnPause) return;
    if (!state.match) { el.pauseText.textContent = '暂停'; el.pauseIcon.textContent = 'Ⅱ'; return; }
    if (state.match.over) {
      el.pauseText.textContent = '已结束';
      el.pauseIcon.textContent = '■';
      el.btnPause.disabled = true;
      return;
    }
    if (state.snapshot) {
      el.pauseText.textContent = '快照';
      el.pauseIcon.textContent = '▣';
      el.btnPause.disabled = true;
      return;
    }
    el.btnPause.disabled = false;
    el.pauseText.textContent = state.running ? '暂停' : '继续';
    el.pauseIcon.textContent = state.running ? 'Ⅱ' : '▶';
  }

  function measureCanvas() {
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.cw = w;
    state.ch = h;
    state.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function roundRectPath(x, y, w, h, r) {
    const p = new Path2D();
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
    return p;
  }

  function computeGeometry() {
    const pad = Math.max(12, Math.min(state.cw, state.ch) * 0.022);
    const size = Math.max(80, Math.min(state.cw - pad * 2, state.ch - pad * 2));
    const cell = size / state.arena.cols;
    return {
      size, cell,
      x: (state.cw - size) / 2,
      y: (state.ch - size) / 2,
      inset: Math.max(0.8, cell * 0.045)
    };
  }

  function buildWallPath(g) {
    const path = new Path2D();
    const cols = state.arena.cols, rows = state.arena.rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const px = g.x + x * g.cell;
        const py = g.y + y * g.cell;
        if (state.arena.walls[i] & C.N) { path.moveTo(px, py); path.lineTo(px + g.cell, py); }
        if (state.arena.walls[i] & C.W) { path.moveTo(px, py); path.lineTo(px, py + g.cell); }
        if (x === cols - 1) { path.moveTo(px + g.cell, py); path.lineTo(px + g.cell, py + g.cell); }
        if (y === rows - 1) { path.moveTo(px, py + g.cell); path.lineTo(px + g.cell, py + g.cell); }
      }
    }
    return path;
  }

  function buildStatic() {
    if (!state.arena) return;
    const g = computeGeometry();
    state.geom = g;
    if (!state.baseCanvas) {
      state.baseCanvas = document.createElement('canvas');
      state.baseCtx = state.baseCanvas.getContext('2d');
    }
    const base = state.baseCanvas;
    base.width = canvas.width;
    base.height = canvas.height;
    const b = state.baseCtx;
    b.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    b.clearRect(0, 0, state.cw, state.ch);

    state.boardPath = roundRectPath(g.x, g.y, g.size, g.size, 15);

    b.fillStyle = '#060b14';
    b.fill(state.boardPath);
    b.strokeStyle = 'rgba(120, 158, 205, 0.16)';
    b.lineWidth = 1;
    b.stroke(state.boardPath);

    b.save();
    b.clip(state.boardPath);

    const cols = state.arena.cols, rows = state.arena.rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const px = g.x + x * g.cell;
        const py = g.y + y * g.cell;
        b.fillStyle = '#08111d';
        b.fillRect(px + g.inset, py + g.inset, g.cell - g.inset * 2, g.cell - g.inset * 2);

        const cost = state.arena.cost[i];
        if (cost === 2) {
          b.fillStyle = 'rgba(192, 150, 92, 0.36)';
          b.beginPath();
          b.arc(px + g.cell * 0.38, py + g.cell * 0.42, Math.max(1, g.cell * 0.06), 0, Math.PI * 2);
          b.arc(px + g.cell * 0.63, py + g.cell * 0.64, Math.max(1, g.cell * 0.06), 0, Math.PI * 2);
          b.fill();
        } else if (cost === 3) {
          b.strokeStyle = 'rgba(82, 156, 178, 0.38)';
          b.lineWidth = Math.max(1, g.cell * 0.055);
          b.beginPath();
          b.moveTo(px + g.cell * 0.28, py + g.cell * 0.68);
          b.lineTo(px + g.cell * 0.48, py + g.cell * 0.4);
          b.lineTo(px + g.cell * 0.66, py + g.cell * 0.56);
          b.stroke();
        }
      }
    }
    b.restore();
    state.wallPath = buildWallPath(g);
    state.dirty = true;
  }

  function drawBoundaryPaths(g, agents) {
    const paths = new Map();
    const cols = state.arena.cols, rows = state.arena.rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const owner = state.match.owner[i];
        if (owner < 0) continue;
        let p = paths.get(owner);
        if (!p) { p = new Path2D(); paths.set(owner, p); }
        const px = g.x + x * g.cell;
        const py = g.y + y * g.cell;
        const right = x === cols - 1 ? -2 : state.match.owner[i + 1];
        const bottom = y === rows - 1 ? -2 : state.match.owner[i + cols];
        if (right !== owner) { p.moveTo(px + g.cell, py); p.lineTo(px + g.cell, py + g.cell); }
        if (bottom !== owner) { p.moveTo(px, py + g.cell); p.lineTo(px + g.cell, py + g.cell); }
        if (y === 0) { p.moveTo(px, py); p.lineTo(px + g.cell, py); }
        if (x === 0) { p.moveTo(px, py); p.lineTo(px, py + g.cell); }
      }
    }
    for (const [owner, path] of paths) {
      const meta = agents[owner];
      const alpha = state.focusAgent && state.focusAgent !== meta.id ? 0.35 : 0.92;
      ctx.strokeStyle = rgba(mix(meta.color, '#ffffff', 0.35), alpha);
      ctx.lineWidth = state.focusAgent === meta.id ? 2.1 : 1.5;
      ctx.stroke(path);
    }
  }

  function renderCanvas() {
    if (!state.match || !state.geom || !state.arena) return;
    const g = state.geom;
    const match = state.match, arena = state.arena;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.cw, state.ch);

    if (state.baseCanvas) ctx.drawImage(state.baseCanvas, 0, 0, state.cw, state.ch);
    ctx.save();
    ctx.clip(state.boardPath);

    const cols = arena.cols, rows = arena.rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const owner = match.owner[i];
        if (owner < 0) continue;
        const meta = match.agents[owner];
        const dim = state.focusAgent && state.focusAgent !== meta.id;
        const alpha = dim ? 0.48 : 0.9;
        const px = g.x + x * g.cell;
        const py = g.y + y * g.cell;
        ctx.fillStyle = rgba(meta.color, alpha);
        ctx.fillRect(px, py, g.cell, g.cell);

        const age = match.tickIndex - match.claimedAt[i];
        if (age >= 0 && age < 5 && !dim) {
          ctx.fillStyle = `rgba(255,255,255,${0.2 * (1 - age / 5)})`;
          ctx.fillRect(px, py, g.cell, g.cell);
        }
      }
    }

    ctx.strokeStyle = '#1b2b40';
    ctx.lineWidth = Math.max(1, g.cell * 0.062);
    ctx.stroke(state.wallPath);

    drawBoundaryPaths(g, match.agents);

    for (const agent of match.agents) {
      const sx = agent.seedCell % cols;
      const sy = Math.floor(agent.seedCell / cols);
      const cx = g.x + (sx + 0.5) * g.cell;
      const cy = g.y + (sy + 0.5) * g.cell;
      const dim = state.focusAgent && state.focusAgent !== agent.id;
      const r = Math.max(2.4, g.cell * 0.19);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba(agent.color, dim ? 0.55 : 1);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeStyle = `rgba(255,255,255,${dim ? 0.35 : 0.85})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(agent.color, dim ? 0.18 : 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (state.hover) {
      const { x, y } = state.hover;
      const px = g.x + x * g.cell;
      const py = g.y + y * g.cell;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 1, py + 1, g.cell - 2, g.cell - 2);
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(120, 158, 205, 0.26)';
    ctx.lineWidth = 1.4;
    ctx.stroke(state.boardPath);
  }

  function updateUI(force) {
    if (!state.match) return;
    const snap = state.match.snapshot();
    const leader = snap.results[0];
    const over = snap.over;

    el.hudStatus.textContent = over ? '领地已瓜分' : state.snapshot ? '定格快照' : state.running ? '争夺中' : '已暂停';
    el.hudPercent.textContent = `${snap.coverage.toFixed(1)}%`;
    el.hudTick.textContent = `T+${String(snap.tick).padStart(3, '0')}`;
    el.tickLabel.textContent = String(snap.tick);
    el.progressBar.style.width = `${Math.min(100, snap.coverage)}%`;
    el.speedLabel.textContent = `${state.speed}× 速度`;
    el.metaSize.textContent = `${state.size} × ${state.size}`;
    el.metaSeed.textContent = String(state.seed);
    el.metaAgents.textContent = String(state.selected.length);
    el.seedReadout.textContent = `#${state.seed}`;
    el.stageTitle.textContent = titleFor(state.selected.length);

    if (leader) {
      el.champEyebrow.textContent = over ? '本局冠军' : '当前领跑';
      el.champName.textContent = leader.name;
      el.champStat.textContent = `${leader.pct.toFixed(1)}% · ${leader.cells} 格`;
      el.champBar.style.width = `${Math.min(100, leader.pct)}%`;
      el.champBar.style.background = leader.color;
      el.champDot.style.background = leader.color;
      el.championCard.style.borderColor = rgba(leader.color, 0.34);
      el.champCrown.style.opacity = over ? '1' : '0.45';
      el.champNote.textContent = over
        ? `最终排名 · ${snap.tick} 轮`
        : `实时领地第一 · ${snap.tick} 轮`;
    } else {
      el.champEyebrow.textContent = '等待开局';
      el.champName.textContent = '—';
      el.champStat.textContent = '0.0% · 0 格';
      el.champBar.style.width = '0%';
      el.champNote.textContent = '实时领地第一';
    }

    el.boardMeta.textContent = over ? '最终排名' : '实时演算';
    const order = snap.results.map(r => r.id).join(',');
    if (order !== state.lastOrder) {
      state.lastOrder = order;
      for (const r of snap.results) {
        const card = state.cards.get(r.id);
        if (card) board.appendChild(card);
      }
    }
    for (const r of snap.results) {
      const card = state.cards.get(r.id);
      if (!card) continue;
      const rank = card.querySelector('.agent-rank');
      const pct = card.querySelector('.agent-pct');
      const bar = card.querySelector('.agent-bar i');
      const cells = card.querySelector('.agent-cells');
      const status = card.querySelector('.agent-status');
      rank.textContent = String(r.rank).padStart(2, '0');
      pct.textContent = `${r.pct.toFixed(1)}%`;
      bar.style.width = `${Math.min(100, r.pct)}%`;
      cells.textContent = `${r.cells} 格`;
      let label = '等待', cls = '';
      if (over) { label = '完成'; cls = 'done'; }
      else if (r.stalled) { label = '受阻'; cls = 'blocked'; }
      else if (r.lastClaimTick === snap.tick) { label = '扩张'; cls = 'active'; }
      status.textContent = label;
      status.className = `agent-status ${cls}`;
      card.classList.toggle('lead', r.rank === 1);
      card.classList.toggle('dim', !!state.focusAgent && state.focusAgent !== r.id);
    }
    if (force) renderCanvas();
  }

  function updateTip(e) {
    if (!state.match || !state.geom) return;
    const g = state.geom;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = Math.floor((mx - g.x) / g.cell);
    const y = Math.floor((my - g.y) / g.cell);
    if (x < 0 || y < 0 || x >= state.arena.cols || y >= state.arena.rows) {
      state.hover = null;
      cellTip.hidden = true;
      state.dirty = true;
      return;
    }
    const i = y * state.arena.cols + x;
    const owner = state.match.owner[i];
    const cost = state.arena.cost[i];
    const terrain = cost === 3 ? '沼泽 ×3' : cost === 2 ? '泥地 ×2' : '通路';
    const who = owner >= 0 ? state.match.agents[owner].name : '未占领';
    state.hover = { x, y };
    cellTip.hidden = false;
    cellTip.textContent = `(${x}, ${y}) · ${terrain} · ${who}`;
    const shellRect = shell.getBoundingClientRect();
    let left = e.clientX - shellRect.left + 14;
    let top = e.clientY - shellRect.top + 14;
    if (left > shellRect.width - 175) left = e.clientX - shellRect.left - 165;
    if (top > shellRect.height - 45) top = e.clientY - shellRect.top - 40;
    cellTip.style.left = `${Math.max(8, left)}px`;
    cellTip.style.top = `${Math.max(8, top)}px`;
    state.dirty = true;
  }

  function openReport() {
    if (!state.match) return;
    const snap = state.match.snapshot();
    el.reportTitle.textContent = snap.over ? '本局战报' : '实时战报';
    el.reportSub.textContent = `种子 ${state.seed} · ${state.size}×${state.size} · 第 ${snap.tick} 轮 · ${snap.over ? '已定局' : '实时快照'}`;
    el.reportBody.innerHTML = '';
    for (const r of snap.results) {
      const row = document.createElement('div');
      row.className = 'report-row';
      row.innerHTML = `
        <span class="r-rank">${String(r.rank).padStart(2, '0')}</span>
        <span class="r-dot" style="background:${r.color}"></span>
        <span class="r-name">${r.name}</span>
        <span class="r-pct">${r.pct.toFixed(1)}%</span>
        <span class="r-cells">${r.cells} 格</span>`;
      el.reportBody.appendChild(row);
    }
    const note = document.createElement('p');
    note.className = 'report-note';
    note.textContent = '面积按全图可通行格子计算；泛洪填充与双向策略每轮推进 2 格，其余算法推进 1 格。相同地图可点「再战同图」复现。';
    el.reportBody.appendChild(note);
    state.reportOpen = true;
    el.reportModal.hidden = false;
    el.btnCloseReport.focus();
  }

  function closeReport() {
    state.reportOpen = false;
    el.reportModal.hidden = true;
  }

  function toast(message) {
    clearTimeout(state.toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    state.toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
  }

  function updateSizeUI() {
    setSeg(el.sizeSeg, 'size', state.size);
    el.braidRange.value = String(state.braid);
    el.braidValue.textContent = `${state.braid}%`;
    setSeg(el.speedSeg, 'speed', state.speed);
    el.seedInput.value = state.seed;
    el.speedLabel.textContent = `${state.speed}× 速度`;
  }

  function scheduleResize() {
    if (state.resizeRaf) return;
    state.resizeRaf = requestAnimationFrame(() => {
      state.resizeRaf = 0;
      if (!state.match) return;
      measureCanvas();
      buildStatic();
      renderCanvas();
    });
  }

  function loop(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(140, ts - state.lastTs);
    state.lastTs = ts;

    let ticked = false;
    if (!state.snapshot && state.running && state.match && !state.match.over) {
      state.acc += dt / 1000 * (state.speed * 8);
      const steps = Math.min(12, Math.floor(state.acc));
      if (steps > 0) {
        state.acc -= steps;
        for (let i = 0; i < steps; i++) {
          state.match.tick();
          if (state.match.over) break;
        }
        ticked = true;
        state.dirty = true;
        if (state.match.over) {
          state.running = false;
          updateUI(true);
          updatePauseButton();
        }
      }
      state.uiAcc += dt;
      if (ticked && state.uiAcc > 95) {
        state.uiAcc = 0;
        updateUI();
      }
    }

    if (state.dirty || (state.running && !state.match.over)) {
      renderCanvas();
      state.dirty = false;
    }
    requestAnimationFrame(loop);
  }

  function bindControls() {
    el.sizeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-size]');
      if (!btn) return;
      state.size = Number(btn.dataset.size);
      updateSizeUI();
      createNewMap(state.seed);
    });

    el.speedSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-speed]');
      if (!btn) return;
      state.speed = Number(btn.dataset.speed);
      setSeg(el.speedSeg, 'speed', state.speed);
      el.speedLabel.textContent = `${state.speed}× 速度`;
      updateUI();
    });

    el.braidRange.addEventListener('input', () => {
      state.braid = Number(el.braidRange.value);
      el.braidValue.textContent = `${state.braid}%`;
    });
    el.braidRange.addEventListener('change', () => createNewMap(state.seed));

    el.btnPause.addEventListener('click', togglePause);
    el.btnRestart.addEventListener('click', restartSameMap);
    el.btnNew.addEventListener('click', () => {
      const seed = el.seedInput.value.trim() || randomSeed();
      createNewMap(seed);
    });
    el.btnDice.addEventListener('click', () => {
      const seed = randomSeed();
      el.seedInput.value = seed;
      createNewMap(seed);
    });
    el.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createNewMap(el.seedInput.value.trim() || randomSeed());
      }
    });
    el.btnApply.addEventListener('click', applySelection);

    el.btnReport.addEventListener('click', openReport);
    el.btnCloseReport.addEventListener('click', closeReport);
    el.btnCloseReport2.addEventListener('click', closeReport);
    el.reportModal.addEventListener('click', (e) => {
      if (e.target.dataset.close === '1') closeReport();
    });
    el.btnReportRestart.addEventListener('click', () => {
      closeReport();
      restartSameMap();
    });

    canvas.addEventListener('pointermove', updateTip);
    canvas.addEventListener('pointerleave', () => {
      state.hover = null;
      cellTip.hidden = true;
      state.dirty = true;
    });

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape' && state.reportOpen) { closeReport(); return; }
      if (state.reportOpen) return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === 'r' || e.key === 'R') { restartSameMap(); }
      else if (e.key === 'n' || e.key === 'N') { createNewMap(el.seedInput.value.trim() || randomSeed()); }
    });

    new ResizeObserver(scheduleResize).observe(shell);
    window.addEventListener('resize', scheduleResize);
  }

  function bindElements() {
    el.metaSize = $('metaSize');
    el.metaSeed = $('metaSeed');
    el.metaAgents = $('metaAgents');
    el.stageTitle = $('stageTitle');
    el.seedReadout = $('seedReadout');
    el.hudStatus = $('hudStatus');
    el.hudPercent = $('hudPercent');
    el.hudTick = $('hudTick');
    el.tickLabel = $('tickLabel');
    el.progressBar = $('progressBar');
    el.speedLabel = $('speedLabel');
    el.champEyebrow = $('champEyebrow');
    el.champName = $('champName');
    el.champStat = $('champStat');
    el.champBar = $('champBar');
    el.champDot = $('champDot');
    el.champNote = $('champNote');
    el.champCrown = $('champCrown');
    el.championCard = $('championCard');
    el.boardMeta = $('boardMeta');
    el.pickCount = $('pickCount');
    el.btnPause = $('btnPause');
    el.pauseText = $('pauseText');
    el.pauseIcon = $('pauseIcon');
    el.btnRestart = $('btnRestart');
    el.btnNew = $('btnNew');
    el.btnApply = $('btnApply');
    el.btnReport = $('btnReport');
    el.btnCloseReport = $('btnCloseReport');
    el.btnCloseReport2 = $('btnCloseReport2');
    el.btnReportRestart = $('btnReportRestart');
    el.reportModal = $('reportModal');
    el.reportTitle = $('reportTitle');
    el.reportSub = $('reportSub');
    el.reportBody = $('reportBody');
    el.sizeSeg = $('sizeSeg');
    el.speedSeg = $('speedSeg');
    el.braidRange = $('braidRange');
    el.braidValue = $('braidValue');
    el.seedInput = $('seedInput');
    el.btnDice = $('btnDice');
  }

  function init() {
    bindElements();
    readParams();
    updateSizeUI();
    buildAlgoChips();
    bindControls();
    createNewMap(state.seed);

    if (state.snapshotRequested) {
      state.running = false;
      C.runTicks(state.match, state.snapshotTicks);
      state.snapshot = true;
      updateUI(true);
      updatePauseButton();
      renderCanvas();
    } else if (!state.autoplay) {
      state.running = false;
      updateUI(true);
      updatePauseButton();
    }

    requestAnimationFrame(loop);
  }

  init();
})();
