/*
 * Shared between browser and Node (server scoring must match client).
 * Difficulty parameters + deterministic difficulty-per-level mixing.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Difficulty = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DIFFS = {
    /*
     * fill  – fraction of the grid the generator tries to cover
     * bias  – probability a snake is oriented so its escape ray points into
     *         other snakes (creates dependency chains = actual difficulty)
     */
    xeasy:  { key: 'xeasy',  label: 'Extra Easy', cols: 14, rows: 18, fill: 0.40, minLen: 3, maxLen: 8,  minSnakes: 14,  bias: 0.30, baseScore: 20 },
    easy:   { key: 'easy',   label: 'Easy',       cols: 18, rows: 24, fill: 0.52, minLen: 3, maxLen: 10, minSnakes: 25,  bias: 0.45, baseScore: 45 },
    medium: { key: 'medium', label: 'Medium',     cols: 24, rows: 32, fill: 0.68, minLen: 3, maxLen: 14, minSnakes: 50,  bias: 0.60, baseScore: 90 },
    hard:   { key: 'hard',   label: 'Hard',       cols: 32, rows: 44, fill: 0.84, minLen: 3, maxLen: 18, minSnakes: 95,  bias: 0.40, baseScore: 170 },
    xhard:  { key: 'xhard',  label: 'Super Hard', cols: 40, rows: 56, fill: 0.90, minLen: 3, maxLen: 22, minSnakes: 130, bias: 0.15, baseScore: 280 }
  };

  // First levels are a fixed gentle ramp, after that a seeded weighted mix
  // that drifts toward harder difficulties as the level number grows.
  var FIXED_START = ['xeasy', 'xeasy', 'easy', 'easy', 'medium', 'hard'];

  var MAX_HEARTS = 3;

  // One deterministic uniform draw in [0,1) from an integer seed.
  function rand01(seed) {
    var a = (Math.imul(seed, 0x9E3779B1) + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function difficultyForLevel(n) {
    n = Math.floor(n);
    if (!isFinite(n) || n < 1) n = 1;
    if (n <= FIXED_START.length) return DIFFS[FIXED_START[n - 1]];

    var t = Math.min(1, (n - FIXED_START.length) / 60);
    var weights = [
      ['xeasy',  lerp(24, 4, t)],
      ['easy',   lerp(34, 10, t)],
      ['medium', lerp(28, 27, t)],
      ['hard',   lerp(10, 34, t)],
      ['xhard',  lerp(4, 25, t)]
    ];
    var total = 0;
    for (var i = 0; i < weights.length; i++) total += weights[i][1];
    var r = rand01(n) * total;
    for (var j = 0; j < weights.length; j++) {
      r -= weights[j][1];
      if (r < 0) return DIFFS[weights[j][0]];
    }
    return DIFFS.xhard;
  }

  // Score for completing `level` with `heartsLeft` hearts remaining.
  function scoreFor(level, heartsLeft) {
    var d = difficultyForLevel(level);
    var h = Math.max(0, Math.min(MAX_HEARTS, Math.floor(heartsLeft || 0)));
    return Math.round(d.baseScore * (1 + 0.15 * h));
  }

  return {
    DIFFS: DIFFS,
    MAX_HEARTS: MAX_HEARTS,
    difficultyForLevel: difficultyForLevel,
    scoreFor: scoreFor
  };
});
