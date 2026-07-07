const path = require('path');
const express = require('express');
const Store = require('./store.js');
const Difficulty = require('../public/js/difficulty.js');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'arrows-admin';

const MAX_LIVES = 5;          // regeneration cap (codes can push above it)
const START_LIVES = 5;
const REGEN_MS = 30 * 60 * 1000; // one life every 30 minutes
const DEFAULT_CODE_LIVES = 3;
const LIVES_HARD_CAP = 99;

// Unambiguous charset (no O/0 or I/1 confusion)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = new Store(path.join(__dirname, 'data', 'db.json'));
const db = store.data;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------- helpers ----------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(res, status, msg) { return res.status(status).json({ error: msg }); }

function genCode(existing) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!existing[c]) return c;
  }
}

function cleanName(raw, max) {
  return String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function regen(u) {
  const now = Date.now();
  if (u.lives >= MAX_LIVES) { u.lastLifeAt = now; return; }
  const gained = Math.floor((now - u.lastLifeAt) / REGEN_MS);
  if (gained > 0) {
    u.lives = Math.min(MAX_LIVES, u.lives + gained);
    u.lastLifeAt = u.lives >= MAX_LIVES ? now : u.lastLifeAt + gained * REGEN_MS;
  }
}

function getUser(req, res) {
  const uuid = String(req.body.uuid || req.query.uuid || '').toLowerCase();
  if (!UUID_RE.test(uuid)) { bad(res, 400, 'Invalid or missing uuid'); return null; }
  const u = db.users[uuid];
  if (!u) { bad(res, 404, 'Unknown player — reload the game'); return null; }
  regen(u);
  return u;
}

function userState(u) {
  const now = Date.now();
  return {
    name: u.name,
    lives: u.lives,
    maxLives: MAX_LIVES,
    nextLifeInMs: u.lives >= MAX_LIVES ? 0 : Math.max(0, u.lastLifeAt + REGEN_MS - now),
    completedLevel: u.completedLevel,
    score: u.score,
    groups: u.groups
      .filter(code => db.groups[code])
      .map(code => ({ code, name: db.groups[code].name, members: db.groups[code].members.length }))
  };
}

function rankEntries(uuids, meUuid) {
  const players = uuids
    .map(id => ({ id, u: db.users[id] }))
    .filter(p => p.u)
    .sort((a, b) => (b.u.score - a.u.score) || (b.u.completedLevel - a.u.completedLevel) || (a.u.createdAt - b.u.createdAt));
  let me = null;
  const entries = players.map((p, i) => {
    const e = { rank: i + 1, name: p.u.name, level: p.u.completedLevel, score: p.u.score, me: p.id === meUuid };
    if (e.me) me = e;
    return e;
  });
  return { entries: entries.slice(0, 50), me };
}

// ---------------- user ----------------
app.post('/api/user/init', (req, res) => {
  const uuid = String(req.body.uuid || '').toLowerCase();
  if (!UUID_RE.test(uuid)) return bad(res, 400, 'Invalid uuid');
  let u = db.users[uuid];
  if (!u) {
    u = db.users[uuid] = {
      name: cleanName(req.body.name, 20) || 'Player-' + uuid.slice(0, 4).toUpperCase(),
      lives: START_LIVES,
      lastLifeAt: Date.now(),
      completedLevel: 0,
      score: 0,
      redeemed: [],
      groups: [],
      createdAt: Date.now()
    };
    store.save();
  }
  regen(u);
  store.save();
  res.json(userState(u));
});

app.post('/api/user/name', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const name = cleanName(req.body.name, 20);
  if (!name) return bad(res, 400, 'Name cannot be empty');
  u.name = name;
  store.save();
  res.json(userState(u));
});

// ---------------- levels ----------------
app.post('/api/level/complete', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const level = Math.floor(Number(req.body.level));
  const hearts = Math.floor(Number(req.body.heartsLeft));
  if (!Number.isFinite(level) || level < 1) return bad(res, 400, 'Invalid level');
  if (level !== u.completedLevel + 1)
    return bad(res, 409, level <= u.completedLevel ? 'Level already completed' : 'Levels must be completed in order');
  const gained = Difficulty.scoreFor(level, Number.isFinite(hearts) ? hearts : 0);
  u.completedLevel = level;
  u.score += gained;
  store.save();
  res.json({ gained, state: userState(u) });
});

app.post('/api/level/fail', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  if (u.lives > 0) {
    if (u.lives >= MAX_LIVES) u.lastLifeAt = Date.now(); // regen timer starts now
    u.lives--;
    store.save();
  }
  res.json(userState(u));
});

// ---------------- life codes ----------------
app.post('/api/redeem', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const code = String(req.body.code || '').toUpperCase().trim();
  const c = db.codes[code];
  if (!c) return bad(res, 404, 'Invalid code');
  if (u.redeemed.includes(code)) return bad(res, 409, 'You already used this code');
  u.redeemed.push(code);
  u.lives = Math.min(LIVES_HARD_CAP, u.lives + c.lives);
  store.save();
  res.json({ added: c.lives, state: userState(u) });
});

// ---------------- groups ----------------
app.post('/api/group/create', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const name = cleanName(req.body.name, 24);
  if (!name) return bad(res, 400, 'Group name cannot be empty');
  const code = genCode(db.groups);
  db.groups[code] = { name, members: [String(req.body.uuid).toLowerCase()], createdAt: Date.now() };
  u.groups.push(code);
  store.save();
  res.json({ code, state: userState(u) });
});

app.post('/api/group/join', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const code = String(req.body.code || '').toUpperCase().trim();
  const g = db.groups[code];
  if (!g) return bad(res, 404, 'No group with that code');
  const uuid = String(req.body.uuid).toLowerCase();
  if (g.members.includes(uuid)) return bad(res, 409, 'You are already in this group');
  g.members.push(uuid);
  u.groups.push(code);
  store.save();
  res.json({ code, state: userState(u) });
});

app.post('/api/group/leave', (req, res) => {
  const u = getUser(req, res); if (!u) return;
  const code = String(req.body.code || '').toUpperCase().trim();
  const g = db.groups[code];
  const uuid = String(req.body.uuid).toLowerCase();
  if (g) {
    g.members = g.members.filter(m => m !== uuid);
    if (!g.members.length) delete db.groups[code];
  }
  u.groups = u.groups.filter(c => c !== code);
  store.save();
  res.json(userState(u));
});

// ---------------- leaderboards ----------------
app.get('/api/leaderboard', (req, res) => {
  const meUuid = String(req.query.uuid || '').toLowerCase();
  res.json(rankEntries(Object.keys(db.users), meUuid));
});

app.get('/api/group/:code/leaderboard', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const g = db.groups[code];
  if (!g) return bad(res, 404, 'No group with that code');
  const meUuid = String(req.query.uuid || '').toLowerCase();
  res.json({ group: { code, name: g.name }, ...rankEntries(g.members, meUuid) });
});

// ---------------- admin ----------------
function checkAdmin(req, res) {
  const key = req.body.key || req.query.key;
  if (key !== ADMIN_KEY) { bad(res, 403, 'Forbidden'); return false; }
  return true;
}

app.post('/api/admin/codes', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const count = Math.min(100, Math.max(1, Math.floor(Number(req.body.count)) || 5));
  const lives = Math.min(50, Math.max(1, Math.floor(Number(req.body.lives)) || DEFAULT_CODE_LIVES));
  const created = [];
  for (let i = 0; i < count; i++) {
    const code = genCode(db.codes);
    db.codes[code] = { lives, createdAt: Date.now() };
    created.push(code);
  }
  store.save();
  res.json({ created, lives });
});

app.get('/api/admin/codes', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const usage = {};
  for (const u of Object.values(db.users))
    for (const c of u.redeemed) usage[c] = (usage[c] || 0) + 1;
  res.json(Object.entries(db.codes).map(([code, c]) => ({
    code, lives: c.lives, redemptions: usage[code] || 0
  })));
});

// ---------------- boot ----------------
if (!Object.keys(db.codes).length) {
  const starter = [];
  for (let i = 0; i < 5; i++) {
    const code = genCode(db.codes);
    db.codes[code] = { lives: DEFAULT_CODE_LIVES, createdAt: Date.now() };
    starter.push(code);
  }
  store.save();
  console.log('Created starter life codes (+' + DEFAULT_CODE_LIVES + ' lives each):');
  starter.forEach(c => console.log('   ' + c));
}

app.listen(PORT, () => {
  console.log(`Arrows running at http://localhost:${PORT}`);
});
