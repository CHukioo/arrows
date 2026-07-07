// Sanity-check the level generator: every level must be non-empty and
// solvable by greedy peeling (there is always a free arrow to tap).
const LevelGen = require('../../public/js/gen.js');

// Wave-based greedy solve: returns null if unsolvable, else the number of
// rounds (each round removes every currently-free arrow — depth of forced
// ordering, a proxy for difficulty).
function solveRounds(lvl) {
  const { cols, rows, snakes } = lvl;
  const owner = new Array(cols * rows).fill(-1);
  for (const s of snakes) for (const [x, y] of s.path) owner[y * cols + x] = s.id;
  const removed = new Set();
  let rounds = 0, changed = true;
  while (changed) {
    changed = false;
    const wave = [];
    for (const s of snakes) {
      if (removed.has(s.id)) continue;
      const dx = s.path[0][0] - s.path[1][0];
      const dy = s.path[0][1] - s.path[1][1];
      let x = s.path[0][0] + dx, y = s.path[0][1] + dy, free = true;
      while (x >= 0 && y >= 0 && x < cols && y < rows) {
        const o = owner[y * cols + x];
        if (o !== -1 && o !== s.id && !removed.has(o)) { free = false; break; }
        x += dx; y += dy;
      }
      if (free) wave.push(s.id);
    }
    if (wave.length) { wave.forEach(id => removed.add(id)); rounds++; changed = true; }
  }
  return removed.size === snakes.length ? rounds : null;
}

const byDiff = {};
let failures = 0;
const N = parseInt(process.argv[2] || '500', 10);
for (let level = 1; level <= N; level++) {
  const lvl = LevelGen.generateLevel(level);
  const cells = lvl.snakes.reduce((a, s) => a + s.path.length, 0);
  const rounds = solveRounds(lvl);
  const d = (byDiff[lvl.diffKey] ||= { count: 0, snakes: 0, min: Infinity, fill: 0, rounds: 0, cells: 0 });
  d.count++; d.snakes += lvl.snakes.length; d.min = Math.min(d.min, lvl.snakes.length);
  d.fill += cells / (lvl.cols * lvl.rows); d.rounds += rounds || 0; d.cells += cells;
  if (lvl.snakes.length < 3) { console.error(`level ${level}: only ${lvl.snakes.length} snakes`); failures++; }
  if (rounds === null) { console.error(`level ${level}: NOT SOLVABLE`); failures++; }
  // determinism check
  const again = LevelGen.generateLevel(level);
  if (JSON.stringify(again) !== JSON.stringify(lvl)) { console.error(`level ${level}: NOT DETERMINISTIC`); failures++; }
}
for (const k of ['xeasy', 'easy', 'medium', 'hard', 'xhard']) {
  const d = byDiff[k]; if (!d) continue;
  console.log(`${k.padEnd(7)} levels=${String(d.count).padStart(4)}` +
    ` avgSnakes=${(d.snakes / d.count).toFixed(1).padStart(5)}` +
    ` minSnakes=${String(d.min).padStart(3)}` +
    ` avgFill=${(d.fill / d.count * 100).toFixed(0)}%` +
    ` avgLen=${(d.cells / d.snakes).toFixed(1)}` +
    ` avgDepth=${(d.rounds / d.count).toFixed(1)}`);
}
console.log(failures === 0 ? `OK: ${N} levels solvable & deterministic` : `FAILURES: ${failures}`);
process.exit(failures ? 1 : 0);
