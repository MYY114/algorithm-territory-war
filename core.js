/*
 * 算法领地争夺战 · Territory Core
 * 纯逻辑：迷宫生成、算法前沿、领地抢占、计分。
 * 不依赖 DOM，可在 Node 中直接测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TerritoryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const N = 1, E = 2, S = 4, W = 8;
  const ALL = N | E | S | W;

  const DIRS = [
    { bit: N, dx: 0, dy: -1, opp: S, name: 'N' },
    { bit: E, dx: 1, dy: 0, opp: W, name: 'E' },
    { bit: S, dx: 0, dy: 1, opp: N, name: 'S' },
    { bit: W, dx: -1, dy: 0, opp: E, name: 'W' }
  ];
  const REVERSED = [DIRS[2], DIRS[3], DIRS[0], DIRS[1]];

  const ALGORITHMS = [
    {
      id: 'flood', name: '泛洪填充', en: 'FLOOD FILL', color: '#38bdf8',
      budget: 2, fronts: 1, kind: 'queue', cost: false, heuristic: false,
      tagline: '地毯式平推', desc: '每轮向外推进 2 格，用铺开的数量压住对手。'
    },
    {
      id: 'bfs', name: '广度优先', en: 'BFS', color: '#a78bfa',
      budget: 1, fronts: 1, kind: 'queue', cost: false, heuristic: false,
      tagline: '层层包围', desc: '一圈一圈均匀扩张，边界最规整，也最容易被堵。'
    },
    {
      id: 'dfs', name: '深度优先', en: 'DFS', color: '#fbbf24',
      budget: 1, fronts: 1, kind: 'stack', cost: false, heuristic: false,
      tagline: '一条路走到黑', desc: '沿走廊深插，容易拉出细长飞地，也容易钻死胡同。'
    },
    {
      id: 'dijkstra', name: '迪杰斯特拉', en: 'DIJKSTRA', color: '#34d399',
      budget: 1, fronts: 1, kind: 'heap', cost: true, heuristic: false,
      tagline: '绕开烂地', desc: '按累计地形代价扩张，优先吞下便宜地块，稳步蚕食。'
    },
    {
      id: 'astar', name: 'A* 搜索', en: 'A* SEARCH', color: '#ef4444',
      budget: 1, fronts: 1, kind: 'heap', cost: true, heuristic: true, weight: 1.45,
      tagline: '尖刀楔形', desc: '带中心启发，朝地图中央扎进去，身后会留出空档。'
    },
    {
      id: 'greedy', name: '贪心最佳', en: 'GREEDY BEST', color: '#f97316',
      budget: 1, fronts: 1, kind: 'heap', cost: false, heuristic: true, weight: 1,
      tagline: '直线冲刺', desc: '只看离中心多远，不管地形，冲得最快也最容易拉散。'
    },
    {
      id: 'bidbfs', name: '双向 BFS', en: 'BIDIRECTIONAL BFS', color: '#c084fc',
      budget: 2, fronts: 2, kind: 'queue', cost: false, heuristic: false,
      tagline: '两头出兵', desc: '两个队列反向包抄，形成双瓣领地，接缝处最容易被人截胡。'
    },
    {
      id: 'bidastar', name: '双向 A*', en: 'BIDIRECTIONAL A*', color: '#f472b6',
      budget: 2, fronts: 2, kind: 'heap', cost: true, heuristic: true, weight: 1.35,
      tagline: '双箭头夹击', desc: '一支扑中心，一支扑最远点，两路夹击，形状像两支箭头。'
    }
  ];

  const DEFAULT_ALGORITHMS = ['flood', 'bidastar', 'dfs', 'astar'];

  // 8 个候选出生点：四角 + 四边中点
  const ANCHOR_LAYOUTS = {
    2: [0, 2],
    3: [0, 1, 6],
    4: [0, 1, 2, 3],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
    8: [0, 1, 2, 3, 4, 5, 6, 7]
  };

  function hashSeed(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
    const text = String(value == null ? '20261124' : value);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    }
    return items;
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function cellOf(cols, x, y) { return y * cols + x; }

  function anchorList(cols, rows) {
    const maxX = cols - 1, maxY = rows - 1;
    const midX = Math.floor(cols / 2), midY = Math.floor(rows / 2);
    return [
      cellOf(cols, 0, 0),
      cellOf(cols, maxX, 0),
      cellOf(cols, maxX, maxY),
      cellOf(cols, 0, maxY),
      cellOf(cols, midX, 0),
      cellOf(cols, maxX, midY),
      cellOf(cols, midX, maxY),
      cellOf(cols, 0, midY)
    ];
  }

  function bfsFarthest(anchor, cols, rows, walls) {
    const total = cols * rows;
    const dist = new Int16Array(total).fill(-1);
    const queue = new Int32Array(total);
    let head = 0, tail = 0, best = anchor;
    dist[anchor] = 0;
    queue[tail++] = anchor;
    while (head < tail) {
      const cur = queue[head++];
      const x = cur % cols, y = Math.floor(cur / cols);
      if (dist[cur] > dist[best]) best = cur;
      for (const d of DIRS) {
        if (walls[cur] & d.bit) continue;
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nxt = ny * cols + nx;
        if (dist[nxt] !== -1) continue;
        dist[nxt] = dist[cur] + 1;
        queue[tail++] = nxt;
      }
    }
    return best;
  }

  /**
   * 生成一张四联通迷宫。所有格子都是可行走的，墙位于格子之间。
   * braid: 额外打通墙面的比例（0-100），越大越开阔。
   */
  function generateArena(options) {
    const opts = options || {};
    const cols = clampInt(opts.cols, 9, 81, 41);
    const rows = clampInt(opts.rows == null ? opts.cols : opts.rows, 9, 81, 41);
    const seed = opts.seed == null ? 20261124 : opts.seed;
    const braid = clampInt(opts.braid, 0, 100, 45);
    const rng = mulberry32(hashSeed(seed));
    const total = cols * rows;

    const walls = new Uint8Array(total).fill(ALL);
    const visited = new Uint8Array(total);
    const stack = [0];
    visited[0] = 1;

    // 递归回溯挖迷宫
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const x = cur % cols, y = Math.floor(cur / cols);
      const candidates = [];
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nxt = ny * cols + nx;
        if (visited[nxt]) continue;
        candidates.push({ dir: d, cell: nxt });
      }
      if (!candidates.length) { stack.pop(); continue; }
      const pick = candidates[Math.floor(rng() * candidates.length)];
      walls[cur] &= ~pick.dir.bit;
      walls[pick.cell] &= ~pick.dir.opp;
      visited[pick.cell] = 1;
      stack.push(pick.cell);
    }

    // 额外打通一些墙面，制造环路和可争夺的开阔地
    const extraTarget = Math.round(total * (braid / 100) * 0.24);
    let removed = 0, guard = 0;
    while (removed < extraTarget && guard < extraTarget * 30) {
      guard++;
      const cur = Math.floor(rng() * total);
      const x = cur % cols, y = Math.floor(cur / cols);
      const dirs = [];
      if (x < cols - 1) dirs.push(DIRS[1]);
      if (y < rows - 1) dirs.push(DIRS[2]);
      if (!dirs.length) continue;
      const d = dirs[Math.floor(rng() * dirs.length)];
      if (!(walls[cur] & d.bit)) continue;
      const nxt = (y + d.dy) * cols + (x + d.dx);
      walls[cur] &= ~d.bit;
      walls[nxt] &= ~d.opp;
      removed++;
    }

    // 挖出几块小广场，让算法在这里正面撞车
    const roomCount = clampInt(opts.rooms, 0, 12, 5);
    for (let r = 0; r < roomCount; r++) {
      const rw = 2 + Math.floor(rng() * 3);
      const rh = 2 + Math.floor(rng() * 3);
      const rx = 1 + Math.floor(rng() * Math.max(1, cols - rw - 2));
      const ry = 1 + Math.floor(rng() * Math.max(1, rows - rh - 2));
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const cur = y * cols + x;
          if (x < rx + rw - 1) {
            walls[cur] &= ~E;
            walls[cur + 1] &= ~W;
          }
          if (y < ry + rh - 1) {
            walls[cur] &= ~S;
            walls[cur + cols] &= ~N;
          }
        }
      }
    }

    // 地形代价：1 普通，2 泥地，3 沼泽
    const cost = new Uint8Array(total).fill(1);
    for (let i = 0; i < total; i++) {
      const roll = rng();
      if (roll < 0.055) cost[i] = 3;
      else if (roll < 0.19) cost[i] = 2;
    }

    const anchors = anchorList(cols, rows);
    const farthest = {};
    for (const anchor of anchors) farthest[anchor] = bfsFarthest(anchor, cols, rows, walls);

    return {
      cols, rows, total, walls, cost, anchors, farthest,
      center: cellOf(cols, Math.floor(cols / 2), Math.floor(rows / 2)),
      seed, braid,
      stats: { extraOpenings: removed, rooms: roomCount }
    };
  }

  function manhattan(cell, target, cols) {
    if (target < 0) return 0;
    const x1 = cell % cols, y1 = Math.floor(cell / cols);
    const x2 = target % cols, y2 = Math.floor(target / cols);
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  class MinHeap {
    constructor(compare) {
      this.data = [];
      this.compare = compare;
    }
    get size() { return this.data.length; }
    push(item) {
      const data = this.data;
      data.push(item);
      let i = data.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.compare(data[p], data[i]) <= 0) break;
        const tmp = data[p]; data[p] = data[i]; data[i] = tmp;
        i = p;
      }
    }
    pop() {
      const data = this.data;
      if (!data.length) return null;
      const top = data[0];
      const last = data.pop();
      if (data.length && last) {
        data[0] = last;
        let i = 0;
        while (true) {
          const l = i * 2 + 1, r = l + 1;
          let best = i;
          if (l < data.length && this.compare(data[l], data[best]) < 0) best = l;
          if (r < data.length && this.compare(data[r], data[best]) < 0) best = r;
          if (best === i) break;
          const tmp = data[i]; data[i] = data[best]; data[best] = tmp;
          i = best;
        }
      }
      return top;
    }
  }

  function makeFront(kind, order, options) {
    const opts = options || {};
    return {
      kind, order: order || DIRS,
      items: [], cursor: 0,
      heap: kind === 'heap' ? new MinHeap((a, b) => (a.priority - b.priority) || (a.cell - b.cell)) : null,
      best: kind === 'heap' ? new Float64Array(opts.total).fill(Infinity) : null,
      seen: kind === 'heap' ? null : new Uint8Array(opts.total),
      target: opts.target == null ? -1 : opts.target,
      cost: !!opts.cost,
      heuristic: !!opts.heuristic,
      weight: opts.weight == null ? 1 : opts.weight
    };
  }

    function frontEmpty(front) {
    if (front.kind === 'heap') return front.heap.size === 0;
    if (front.kind === 'stack') return front.items.length === 0;
    return front.cursor >= front.items.length;
  }

  function frontPop(front) {
    if (front.kind === 'heap') return front.heap.pop();
    if (front.kind === 'stack') return front.items.pop() || null;
    return front.cursor < front.items.length ? front.items[front.cursor++] : null;
  }

  function frontAddNeighbors(front, arena, owner, fromCell, baseCost) {
    const cols = arena.cols, rows = arena.rows;
    const x = fromCell % cols, y = Math.floor(fromCell / cols);
    for (const d of front.order) {
      if (arena.walls[fromCell] & d.bit) continue;
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nxt = ny * cols + nx;
      if (owner[nxt] !== -1) continue;

      const stepCost = baseCost + arena.cost[nxt];
      const h = front.heuristic ? manhattan(nxt, front.target, cols) : 0;

      if (front.kind === 'heap') {
        if (front.cost) {
          if (stepCost >= front.best[nxt]) continue;
          front.best[nxt] = stepCost;
          const priority = stepCost + (front.heuristic ? front.weight * h : 0);
          front.heap.push({ cell: nxt, cost: stepCost, priority });
        } else {
          if (front.best[nxt] !== Infinity) continue;
          front.best[nxt] = 0;
          front.heap.push({ cell: nxt, cost: stepCost, priority: h });
        }
      } else {
        if (front.seen[nxt]) continue;
        front.seen[nxt] = 1;
        front.items.push({ cell: nxt, cost: stepCost });
      }
    }
  }

  class Match {
    constructor(arena, algorithmIds, seed) {
      this.arena = arena;
      this.cols = arena.cols;
      this.rows = arena.rows;
      this.total = arena.total;
      this.openCount = arena.total;

      const ids = (algorithmIds && algorithmIds.length ? algorithmIds : DEFAULT_ALGORITHMS).slice();
      const seenIds = new Set();
      const valid = [];
      for (const id of ids) {
        if (seenIds.has(id)) continue;
        const meta = ALGORITHMS.find(a => a.id === id);
        if (meta) { seenIds.add(id); valid.push(meta); }
      }
      if (valid.length < 2) throw new Error('至少需要 2 个算法参赛');
      if (valid.length > 8) throw new Error('最多支持 8 个算法参赛');

      const layout = ANCHOR_LAYOUTS[valid.length];
      this.rng = mulberry32(hashSeed(String(seed == null ? arena.seed : seed) + ':match'));
      this.owner = new Int16Array(this.total).fill(-1);
      this.claimedAt = new Int32Array(this.total).fill(-1);
      this.claimed = 0;
      this.tickIndex = 0;
      this.idleTicks = 0;
      this.over = false;
      this.finishedAt = null;
      this.results = null;

      this.agents = valid.map((meta, i) => {
        const seedCell = arena.anchors[layout[i]];
        return {
          ...meta,
          index: i,
          seedCell,
          claimed: 0,
          wasted: 0,
          lastClaimTick: 0,
          stalled: false,
          frontCursor: 0,
          frontCount: meta.fronts || 1,
          frontiers: []
        };
      });

      for (const agent of this.agents) this.claim(agent.seedCell, agent);

      for (const agent of this.agents) {
        const count = agent.frontCount;
        const targets = count === 2
          ? [arena.center, arena.farthest[agent.seedCell]]
          : [agent.heuristic ? arena.center : -1];
        for (let i = 0; i < count; i++) {
          const front = makeFront(agent.kind, i === 1 ? REVERSED : DIRS, {
            total: this.total,
            target: targets[i],
            cost: agent.cost,
            heuristic: agent.heuristic,
            weight: agent.weight
          });
          frontAddNeighbors(front, arena, this.owner, agent.seedCell, 0);
          agent.frontiers.push(front);
        }
      }
    }

    claim(cell, agent) {
      if (this.owner[cell] !== -1) return false;
      this.owner[cell] = agent.index;
      this.claimedAt[cell] = this.tickIndex;
      agent.claimed++;
      agent.lastClaimTick = this.tickIndex;
      this.claimed++;
      return true;
    }

    expandAgent(agent) {
      if (agent.stalled) return 0;
      const budget = agent.budget;
      let claims = 0, guard = 0;
      while (claims < budget && guard < budget * 400) {
        let front = agent.frontiers[agent.frontCursor % agent.frontiers.length];
        agent.frontCursor = (agent.frontCursor + 1) % agent.frontiers.length;
        if (frontEmpty(front)) {
          if (agent.frontiers.every(frontEmpty)) break;
          guard++;
          continue;
        }
        const item = frontPop(front);
        guard++;
        if (!item) break;
        if (this.owner[item.cell] !== -1) {
          agent.wasted++;
          continue;
        }
        if (!this.claim(item.cell, agent)) {
          agent.wasted++;
          continue;
        }
        frontAddNeighbors(front, this.arena, this.owner, item.cell, item.cost || 0);
        claims++;
      }
      return claims;
    }

    tick() {
      if (this.over) return this.snapshot();
      this.tickIndex++;

      let anyClaim = 0;
      const order = shuffle(this.agents.filter(a => !a.stalled), this.rng);
      for (const agent of order) {
        const got = this.expandAgent(agent);
        anyClaim += got;
        if (got === 0 && agent.frontiers.every(frontEmpty)) agent.stalled = true;
      }

      if (this.claimed >= this.openCount) {
        this.finish();
      } else if (this.agents.every(a => a.stalled)) {
        this.finish();
      } else if (anyClaim === 0) {
        this.idleTicks++;
        if (this.idleTicks >= 3) this.finish();
      } else {
        this.idleTicks = 0;
      }

      if (!this.over && this.tickIndex > this.openCount * 3 + 60) this.finish();
      return this.snapshot();
    }

    finish() {
      if (this.over) return;
      this.over = true;
      this.finishedAt = this.tickIndex;
      for (const agent of this.agents) {
        if (agent.frontiers.every(frontEmpty)) agent.stalled = true;
      }
      this.results = this.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        en: agent.en,
        color: agent.color,
        cells: agent.claimed,
        pct: agent.claimed / this.openCount * 100,
        wasted: agent.wasted,
        stalled: agent.stalled,
        seedCell: agent.seedCell
      })).sort((a, b) => (b.cells - a.cells) || (a.wasted - b.wasted) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map((item, index) => ({ ...item, rank: index + 1 }));
    }

    snapshot() {
      const agents = this.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        en: agent.en,
        color: agent.color,
        cells: agent.claimed,
        pct: agent.claimed / this.openCount * 100,
        wasted: agent.wasted,
        stalled: agent.stalled,
        lastClaimTick: agent.lastClaimTick,
        seedCell: agent.seedCell,
        budget: agent.budget,
        frontCount: agent.frontCount
      }));
      const results = (this.results
        ? this.results
        : agents.slice().sort((a, b) => (b.cells - a.cells) || (a.wasted - b.wasted) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
          .map((item, index) => ({ ...item, rank: index + 1 }))
      );
      return {
        tick: this.tickIndex,
        over: this.over,
        finishedAt: this.finishedAt,
        claimed: this.claimed,
        openCount: this.openCount,
        coverage: this.claimed / this.openCount * 100,
        agents,
        results,
        winnerId: this.over ? results[0].id : null
      };
    }
  }

  function createMatch(arena, algorithmIds, seed) {
    return new Match(arena, algorithmIds, seed);
  }

  function runTicks(match, ticks) {
    for (let i = 0; i < ticks && !match.over; i++) match.tick();
    return match;
  }

  function simulate(options) {
    const opts = options || {};
    const arena = generateArena(opts);
    const match = createMatch(arena, opts.algos, opts.matchSeed == null ? opts.seed : opts.matchSeed);
    runTicks(match, opts.ticks == null ? arena.total * 3 : opts.ticks);
    return { arena, match, snapshot: match.snapshot() };
  }

  return {
    N, E, S, W, DIRS, ALGORITHMS, DEFAULT_ALGORITHMS, ANCHOR_LAYOUTS,
    hashSeed, mulberry32, shuffle, generateArena, createMatch, runTicks, simulate, MinHeap
  };
});
