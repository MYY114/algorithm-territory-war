const assert = require('node:assert/strict');
const C = require('../core.js');

const arena = C.generateArena({
  cols: 31, rows: 31, seed: '20261124', braid: 45, rooms: 5
});

assert.equal(arena.total, 961);
assert.equal(arena.cols, 31);
assert.equal(arena.rows, 31);
assert.equal(arena.stats.rooms, 5);
assert.ok(arena.stats.extraOpenings >= 0);

const match = C.createMatch(arena, C.DEFAULT_ALGORITHMS, '20261124:match');
C.runTicks(match, 320);
const snap = match.snapshot();

assert.equal(snap.over, true);
assert.equal(snap.claimed, match.openCount);
assert.equal(snap.coverage, 100);
assert.equal(snap.results.length, 4);
assert.equal(snap.winnerId, 'bidastar');

const totalCells = snap.results.reduce((sum, item) => sum + item.cells, 0);
assert.equal(totalCells, match.openCount);

const replay = C.createMatch(arena, C.DEFAULT_ALGORITHMS, '20261124:match');
C.runTicks(replay, 320);
const replaySnap = replay.snapshot();
const brief = (results) => results.map(r => [r.id, r.cells, r.rank, r.wasted]);
assert.deepEqual(brief(replaySnap.results), brief(snap.results));

console.log('smoke test passed');
console.log('open cells:', match.openCount);
console.log('ticks:', snap.tick);
console.log(snap.results.map(r => `${r.rank}. ${r.name} ${r.pct.toFixed(1)}% (${r.cells})`).join('\n'));
