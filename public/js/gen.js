/*
 * Deterministic level generator. Level N produces the same board for every
 * player (seeded PRNG), so leaderboard scores are comparable.
 *
 * A board is a grid partially filled with "snakes": non-overlapping paths of
 * orthogonally adjacent cells. path[0] is the head; the snake escapes by
 * sliding straight out along its head direction. A snake is blocked while any
 * cell of that escape ray is occupied by another snake still on the board.
 *
 * Solvability is guaranteed by construction: after filling, we repeatedly
 * "peel" (simulate removing every currently-free snake); any snake that can
 * never become free gets its head flipped to the other end, or is deleted.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./difficulty.js'));
  else root.LevelGen = factory(root.Difficulty);
})(typeof self !== 'undefined' ? self : this, function (Difficulty) {
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  // Generate several candidate boards and keep the most tangled one:
  // primary metric is peel rounds (how many waves of "currently free" arrows
  // a solver must clear — deeper chains = harder), then covered cells.
  function generateLevel(level) {
    var diff = Difficulty.difficultyForLevel(level);
    var bestValid = null, bestValidQ = -1;
    var bestAny = null, bestAnyQ = -1;
    // fewer candidate boards for huge grids to keep generation fast
    var size = diff.cols * diff.rows;
    var attempts = size > 1500 ? 2 : size > 1000 ? 3 : size > 500 ? 6 : 10;
    for (var attempt = 0; attempt < attempts; attempt++) {
      var rng = mulberry32(Math.imul(level, 2654435761) ^ Math.imul(attempt + 1, 40503));
      var r = tryGenerate(diff, rng);
      var q = r.rounds * 100000 + r.cells;
      if (r.snakes.length >= (diff.minSnakes || 3)) {
        if (q > bestValidQ) { bestValidQ = q; bestValid = r; }
      }
      if (q > bestAnyQ) { bestAnyQ = q; bestAny = r; }
    }
    return pack(level, diff, (bestValid || bestAny).snakes);
  }

  function pack(level, diff, snakes) {
    return {
      level: level,
      diffKey: diff.key,
      diffLabel: diff.label,
      cols: diff.cols,
      rows: diff.rows,
      snakes: snakes.map(function (s, i) { return { id: i, path: s.path }; })
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function tryGenerate(diff, rng) {
    var cols = diff.cols, rows = diff.rows;
    var owner = new Array(cols * rows).fill(-1);
    var alive = [];
    var target = Math.floor(cols * rows * diff.fill);
    var nextId = 0;

    // Multi-pass fill: sweep the remaining empty cells in random order and
    // grow a snake from each, until the target coverage is reached or a full
    // pass makes no progress. Reaches much higher density than random darts.
    function fill() {
      var placed = [];
      var progress = true;
      var occupied = 0;
      for (var k = 0; k < owner.length; k++) if (owner[k] !== -1) occupied++;
      while (occupied < target && progress) {
        progress = false;
        var empties = [];
        for (var k2 = 0; k2 < owner.length; k2++) if (owner[k2] === -1) empties.push(k2);
        shuffle(empties, rng);
        for (var e = 0; e < empties.length && occupied < target; e++) {
          var c = empties[e];
          if (owner[c] !== -1) continue;
          // sqrt-skew toward maxLen: long snakes are the point, short ones
          // only appear where fragmented space cuts a walk short anyway
          var wantLen = diff.minLen +
            Math.floor(Math.sqrt(rng()) * (diff.maxLen - diff.minLen + 1));
          var path = walk(c % cols, Math.floor(c / cols), wantLen, owner, cols, rows, rng);
          if (path.length < diff.minLen) continue;
          var id = nextId++;
          for (var i = 0; i < path.length; i++) owner[path[i][1] * cols + path[i][0]] = id;
          placed.push({ id: id, path: path });
          occupied += path.length;
          progress = true;
        }
      }
      // Pick a head end for each new snake such that its escape ray never
      // crosses its own body (a self-crossing snake could never leave).
      for (var s = 0; s < placed.length; s++) {
        var sn = placed[s];
        var oriented = orient(sn.path, sn.id, owner, cols, rows, rng, diff.bias || 0);
        if (oriented) { sn.path = oriented; alive.push(sn); }
        else clearCells(sn, owner, cols);
      }
    }

    // Repair deletes snakes that can never escape, carving holes in dense
    // boards — so fill again into the gaps and repair once more.
    for (var round = 0; round < 12; round++) {
      fill();
      repair(alive, owner, cols, rows);
    }

    var cells = 0;
    for (var a = 0; a < alive.length; a++) cells += alive[a].path.length;
    return { snakes: alive, rounds: peel(alive, owner, cols, rows).rounds, cells: cells };
  }

  // Grow a path from a start cell; when the forward end dead-ends in
  // fragmented space, keep growing backwards from the start cell so long
  // snakes stay possible on dense boards.
  function walk(sx, sy, wantLen, owner, cols, rows, rng) {
    var path = [[sx, sy]];
    var local = {}; local[sy * cols + sx] = true;

    function grow(atFront) {
      var lastDir = null;
      if (path.length > 1) {
        var a = atFront ? path[0] : path[path.length - 1];
        var b = atFront ? path[1] : path[path.length - 2];
        lastDir = [a[0] - b[0], a[1] - b[1]];
      }
      while (path.length < wantLen) {
        var cur = atFront ? path[0] : path[path.length - 1];
        var options = [];
        for (var d = 0; d < 4; d++) {
          var nx = cur[0] + DIRS[d][0], ny = cur[1] + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          var k = ny * cols + nx;
          if (owner[k] !== -1 || local[k]) continue;
          options.push(DIRS[d]);
        }
        if (!options.length) return;
        var dir;
        var canStraight = lastDir && options.some(function (o) { return o[0] === lastDir[0] && o[1] === lastDir[1]; });
        if (canStraight && rng() < 0.55) dir = lastDir;
        else dir = options[randInt(rng, 0, options.length - 1)];
        var np = [cur[0] + dir[0], cur[1] + dir[1]];
        if (atFront) path.unshift(np); else path.push(np);
        local[np[1] * cols + np[0]] = true;
        lastDir = dir;
      }
    }

    grow(false);
    if (path.length < wantLen) grow(true);
    return path;
  }

  function headDir(path) {
    return [path[0][0] - path[1][0], path[0][1] - path[1][1]];
  }

  // Walk the escape ray; returns true if it crosses the snake's own body.
  function selfBlocks(path, selfId, owner, cols, rows) {
    var dir = headDir(path);
    var x = path[0][0] + dir[0], y = path[0][1] + dir[1];
    while (x >= 0 && y >= 0 && x < cols && y < rows) {
      if (owner[y * cols + x] === selfId) return true;
      x += dir[0]; y += dir[1];
    }
    return false;
  }

  // Cells on the escape ray currently occupied by other snakes.
  function blockerCells(path, selfId, owner, cols, rows) {
    var dir = headDir(path);
    var x = path[0][0] + dir[0], y = path[0][1] + dir[1];
    var n = 0;
    while (x >= 0 && y >= 0 && x < cols && y < rows) {
      var o = owner[y * cols + x];
      if (o !== -1 && o !== selfId) n++;
      x += dir[0]; y += dir[1];
    }
    return n;
  }

  function orient(path, selfId, owner, cols, rows, rng, bias) {
    var a = path.slice();           // head at walk start
    var b = path.slice().reverse(); // head at walk end
    var aOk = !selfBlocks(a, selfId, owner, cols, rows);
    var bOk = !selfBlocks(b, selfId, owner, cols, rows);
    if (!aOk && !bOk) return null;
    if (aOk !== bOk) return aOk ? a : b;
    // Both ends are valid: with probability `bias` point the head into the
    // crowd (more blockers = deeper dependency chains), otherwise random.
    if (rng() < bias) {
      var ba = blockerCells(a, selfId, owner, cols, rows);
      var bb = blockerCells(b, selfId, owner, cols, rows);
      if (ba !== bb) return ba > bb ? a : b;
    }
    return rng() < 0.5 ? a : b;
  }

  function clearCells(snake, owner, cols) {
    for (var i = 0; i < snake.path.length; i++) {
      var c = snake.path[i];
      owner[c[1] * cols + c[0]] = -1;
    }
  }

  function rayClear(snake, owner, removed, cols, rows) {
    var dir = headDir(snake.path);
    var x = snake.path[0][0] + dir[0], y = snake.path[0][1] + dir[1];
    while (x >= 0 && y >= 0 && x < cols && y < rows) {
      var o = owner[y * cols + x];
      if (o !== -1 && o !== snake.id && !removed[o]) return false;
      x += dir[0]; y += dir[1];
    }
    return true;
  }

  // Simulate playing the board in waves: each round removes every snake that
  // is currently free. Returns unsolvable leftovers and the round count
  // (a proxy for how deep the forced ordering goes).
  function peel(alive, owner, cols, rows) {
    var removed = {};
    var rounds = 0;
    var changed = true;
    while (changed) {
      changed = false;
      var wave = [];
      for (var i = 0; i < alive.length; i++) {
        var s = alive[i];
        if (!removed[s.id] && rayClear(s, owner, removed, cols, rows)) wave.push(s.id);
      }
      if (wave.length) {
        for (var w = 0; w < wave.length; w++) removed[wave[w]] = true;
        rounds++;
        changed = true;
      }
    }
    return {
      stuck: alive.filter(function (s) { return !removed[s.id]; }),
      rounds: rounds
    };
  }

  // Make the board solvable. Note a snake's body never moves when its head
  // is flipped, so flipping one snake never changes what blocks the others —
  // batch flips are independent. Stuck snakes sit in dependency cycles;
  // deleting one member often frees the rest, so instead of dropping whole
  // cycles we delete only the worst offenders (the stuck snakes whose bodies
  // block the most other stuck snakes), then let everyone try flipping again.
  function repair(alive, owner, cols, rows) {
    var flipped = {};
    for (var iter = 0; iter < 300; iter++) {
      var stuck = peel(alive, owner, cols, rows).stuck;
      if (!stuck.length) return;

      var didFlip = false;
      for (var i = 0; i < stuck.length; i++) {
        var s = stuck[i];
        if (flipped[s.id]) continue;
        var rev = s.path.slice().reverse();
        if (!selfBlocks(rev, s.id, owner, cols, rows)) {
          s.path = rev;
          flipped[s.id] = true;
          didFlip = true;
        }
      }
      if (didFlip) continue;

      // deletion round: rank stuck snakes by how many other stuck snakes
      // their body blocks, remove the top slice, then allow re-flipping
      var inStuck = {};
      for (var t = 0; t < stuck.length; t++) inStuck[stuck[t].id] = true;
      var score = {};
      for (var b = 0; b < stuck.length; b++) {
        var sn = stuck[b];
        var dir = headDir(sn.path);
        var x = sn.path[0][0] + dir[0], y = sn.path[0][1] + dir[1];
        var seen = {};
        while (x >= 0 && y >= 0 && x < cols && y < rows) {
          var o = owner[y * cols + x];
          if (o !== -1 && o !== sn.id && inStuck[o] && !seen[o]) {
            seen[o] = true;
            score[o] = (score[o] || 0) + 1;
          }
          x += dir[0]; y += dir[1];
        }
      }
      // normalize by length so long snakes (the interesting ones) are kept
      // and cycles are broken by sacrificing short snakes instead
      stuck.sort(function (a, b2) {
        var qa = (score[a.id] || 0) / Math.sqrt(a.path.length);
        var qb = (score[b2.id] || 0) / Math.sqrt(b2.path.length);
        return qb - qa || a.id - b2.id;
      });
      var k = Math.max(1, Math.ceil(stuck.length * 0.05));
      var dead = {};
      for (var d = 0; d < k; d++) {
        clearCells(stuck[d], owner, cols);
        dead[stuck[d].id] = true;
      }
      for (var a2 = alive.length - 1; a2 >= 0; a2--) if (dead[alive[a2].id]) alive.splice(a2, 1);
      flipped = {};
    }
    // safety net: drop anything still stuck (peeled remainder is solvable)
    var rest = peel(alive, owner, cols, rows).stuck;
    var dead2 = {};
    for (var r2 = 0; r2 < rest.length; r2++) { clearCells(rest[r2], owner, cols); dead2[rest[r2].id] = true; }
    for (var a3 = alive.length - 1; a3 >= 0; a3--) if (dead2[alive[a3].id]) alive.splice(a3, 1);
  }

  return { generateLevel: generateLevel };
});
