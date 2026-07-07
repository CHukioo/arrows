/* App orchestration: screens, user state, level flow, leaderboards, groups. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const iconSvg = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  // ---------- identity ----------
  let uuid = localStorage.getItem('arrows_uuid');
  if (!uuid) {
    uuid = (crypto.randomUUID && crypto.randomUUID()) ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    localStorage.setItem('arrows_uuid', uuid);
  }

  let user = null;       // server state
  let game = null;       // active ArrowsGame
  let gridMode = localStorage.getItem('arrows_grid') === '1';
  let currentLevel = 0;
  let livesTicker = 0;
  let offline = false;

  // ---------- helpers ----------
  function show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(screenId).classList.add('active');
  }

  let toastTimer = 0;
  function toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModals() { document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); }

  document.querySelectorAll('.btn-close-modal').forEach(b =>
    b.addEventListener('click', closeModals));

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- user / home ----------
  async function boot() {
    try {
      user = await Api.initUser(uuid);
      offline = false;
    } catch (e) {
      offline = true;
      user = user || {
        name: 'Player', lives: 5, maxLives: 5, nextLifeInMs: 0,
        completedLevel: parseInt(localStorage.getItem('arrows_local_level') || '0', 10),
        score: 0, groups: []
      };
    }
    $('offline-note').classList.toggle('hidden', !offline);
    renderHome();
  }

  function renderHome() {
    if (!user) return;
    $('btn-name').textContent = user.name;
    $('stat-score').textContent = user.score.toLocaleString();
    $('stat-level').textContent = user.completedLevel;
    const next = user.completedLevel + 1;
    $('home-level').textContent = next;
    $('home-diff').textContent = Difficulty.difficultyForLevel(next).label;
    renderLives();
  }

  function renderLives() {
    $('lives-count').textContent = user.lives;
    const out = user.lives <= 0;
    $('btn-play').disabled = out;
    $('no-lives-hint').classList.toggle('hidden', !out);

    clearInterval(livesTicker);
    if (user.lives < user.maxLives && user.nextLifeInMs > 0) {
      let target = Date.now() + user.nextLifeInMs;
      const tick = () => {
        const left = target - Date.now();
        if (left <= 0) { boot(); return; }
        $('lives-timer').textContent = fmtTime(left);
      };
      tick();
      livesTicker = setInterval(tick, 1000);
    } else {
      $('lives-timer').textContent = '';
    }
  }

  function applyState(state) {
    if (state) { user = state; renderHome(); }
  }

  // ---------- game flow ----------
  function startLevel(level) {
    currentLevel = level;
    $('game-level').textContent = 'Level ' + level;
    $('game-diff').textContent = Difficulty.difficultyForLevel(level).label;
    setHearts(Difficulty.MAX_HEARTS);
    closeModals();
    show('screen-game');

    if (game) game.destroy();
    // generate after the screen is visible: big boards can take ~1s to
    // build, and the canvas needs real dimensions for layout anyway
    requestAnimationFrame(() => {
      const data = LevelGen.generateLevel(level);
      game = new ArrowsGame($('board'), data, {
        onHearts: setHearts,
        onFail: onLevelFailed,
        onWin: onLevelWon
      });
      game.setGridMode(gridMode);
    });
  }

  function setHearts(n) {
    const spans = $('game-hearts').children;
    for (let i = 0; i < spans.length; i++)
      spans[i].classList.toggle('lost', i >= n);
  }

  async function onLevelWon(heartsLeft) {
    let gained = Difficulty.scoreFor(currentLevel, heartsLeft);
    if (!offline) {
      try {
        const res = await Api.completeLevel(uuid, currentLevel, heartsLeft);
        gained = res.gained;
        applyState(res.state);
      } catch (e) {
        toast('Could not save progress: ' + e.message, 'error');
        user.completedLevel = Math.max(user.completedLevel, currentLevel);
        user.score += gained;
      }
    } else {
      user.completedLevel = Math.max(user.completedLevel, currentLevel);
      user.score += gained;
      localStorage.setItem('arrows_local_level', String(user.completedLevel));
    }
    renderHome();
    $('done-level').textContent = currentLevel;
    $('done-gained').textContent = gained;
    $('done-total').textContent = user.score.toLocaleString();
    openModal('overlay-complete');
  }

  async function onLevelFailed() {
    if (!offline) {
      try { applyState(await Api.failLevel(uuid)); }
      catch (e) { user.lives = Math.max(0, user.lives - 1); renderHome(); }
    } else {
      user.lives = Math.max(0, user.lives - 1);
      renderHome();
    }
    $('failed-lives').textContent = user.lives > 0
      ? `You have ${user.lives} ${user.lives === 1 ? 'life' : 'lives'} left.`
      : 'No lives left — wait for a refill or redeem a code.';
    $('btn-retry').classList.toggle('hidden', user.lives <= 0);
    $('btn-failed-redeem').classList.toggle('hidden', user.lives > 0);
    openModal('overlay-failed');
  }

  // ---------- leaderboard ----------
  let lbTab = 'global';

  async function openLeaderboard() {
    show('screen-leaderboard');
    renderLbTabs();
    await loadLeaderboard();
  }

  function renderLbTabs() {
    const tabs = $('lb-tabs');
    tabs.innerHTML = '';
    const mk = (key, label, icon) => {
      const b = document.createElement('button');
      b.className = 'tab' + (lbTab === key ? ' active' : '');
      b.innerHTML = iconSvg(icon);
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => { lbTab = key; renderLbTabs(); loadLeaderboard(); });
      tabs.appendChild(b);
    };
    mk('global', 'Global', 'globe');
    (user.groups || []).forEach(g => mk(g.code, g.name, 'users'));
    if (lbTab !== 'global' && !(user.groups || []).some(g => g.code === lbTab)) lbTab = 'global';
  }

  async function loadLeaderboard() {
    const list = $('lb-list');
    list.innerHTML = '<div class="lb-empty">Loading…</div>';
    try {
      const data = lbTab === 'global'
        ? await Api.leaderboard(uuid)
        : await Api.groupLeaderboard(lbTab, uuid);
      list.innerHTML = '';
      if (!data.entries.length) {
        list.innerHTML = '<div class="lb-empty">No players yet — be the first!</div>';
        return;
      }
      const rows = data.entries.slice();
      if (data.me && !rows.some(r => r.me)) rows.push(data.me);
      for (const e of rows) {
        const row = document.createElement('div');
        row.className = 'lb-row' + (e.me ? ' me' : '');
        const rank = document.createElement('div');
        rank.className = 'lb-rank' + (e.rank <= 3 ? ' top' + e.rank : '');
        if (e.rank <= 3) rank.innerHTML = iconSvg('medal');
        else rank.textContent = '#' + e.rank;
        const name = document.createElement('div');
        name.className = 'lb-name';
        name.textContent = e.name + (e.me ? ' (you)' : '');
        const info = document.createElement('div');
        info.innerHTML = '<div class="lb-score"></div><div class="lb-level"></div>';
        info.querySelector('.lb-score').textContent = e.score.toLocaleString();
        info.querySelector('.lb-level').textContent = 'level ' + e.level;
        info.style.textAlign = 'right';
        row.append(rank, name, info);
        list.appendChild(row);
      }
    } catch (e) {
      list.innerHTML = '<div class="lb-empty">Could not load leaderboard</div>';
    }
  }

  // ---------- groups ----------
  function renderGroups() {
    const list = $('group-list');
    list.innerHTML = '';
    const groups = user.groups || [];
    if (!groups.length) {
      list.innerHTML = '<div class="lb-empty">You are not in any group yet.<br>Create one and share the code with friends!</div>';
      return;
    }
    for (const g of groups) {
      const card = document.createElement('div');
      card.className = 'group-card';

      const head = document.createElement('div');
      head.className = 'group-head';
      const nm = document.createElement('div');
      nm.className = 'group-name';
      nm.textContent = g.name;
      const code = document.createElement('button');
      code.className = 'group-code';
      code.textContent = g.code;
      code.title = 'Copy code';
      code.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(g.code); toast('Code copied!', 'success'); }
        catch (_) { toast('Code: ' + g.code); }
      });
      head.append(nm, code);

      const meta = document.createElement('div');
      meta.className = 'group-meta';
      meta.textContent = `${g.members} ${g.members === 1 ? 'player' : 'players'}`;

      const btns = document.createElement('div');
      btns.className = 'group-btns';
      const lb = document.createElement('button');
      lb.className = 'btn btn-ghost';
      lb.innerHTML = iconSvg('trophy');
      lb.appendChild(document.createTextNode('Leaderboard'));
      lb.addEventListener('click', () => { lbTab = g.code; openLeaderboard(); });
      const leave = document.createElement('button');
      leave.className = 'btn btn-danger-ghost';
      leave.textContent = 'Leave';
      leave.addEventListener('click', async () => {
        try {
          applyState(await Api.leaveGroup(uuid, g.code));
          renderGroups();
          toast('Left ' + g.name);
        } catch (e) { toast(e.message, 'error'); }
      });
      btns.append(lb, leave);

      card.append(head, meta, btns);
      list.appendChild(card);
    }
  }

  // ---------- wiring ----------
  $('btn-play').addEventListener('click', () => {
    if (user.lives <= 0) { toast('No lives left!', 'error'); return; }
    startLevel(user.completedLevel + 1);
  });

  function applyGridBtn() {
    $('btn-grid').classList.toggle('active', gridMode);
    $('btn-grid').setAttribute('aria-pressed', String(gridMode));
  }
  applyGridBtn();
  $('btn-grid').addEventListener('click', () => {
    gridMode = !gridMode;
    localStorage.setItem('arrows_grid', gridMode ? '1' : '0');
    applyGridBtn();
    if (game) game.setGridMode(gridMode);
  });

  $('btn-quit').addEventListener('click', () => {
    if (game) { game.destroy(); game = null; }
    closeModals();
    show('screen-home');
    boot();
  });

  $('btn-next').addEventListener('click', () => {
    if (user.lives <= 0) { closeModals(); show('screen-home'); toast('No lives left!', 'error'); return; }
    startLevel(user.completedLevel + 1);
  });
  $('btn-done-home').addEventListener('click', () => { closeModals(); show('screen-home'); });

  $('btn-retry').addEventListener('click', () => {
    if (user.lives <= 0) { closeModals(); show('screen-home'); return; }
    startLevel(currentLevel);
  });
  $('btn-failed-home').addEventListener('click', () => { closeModals(); show('screen-home'); });
  $('btn-failed-redeem').addEventListener('click', () => { closeModals(); show('screen-home'); openModal('modal-redeem'); $('redeem-code').focus(); });

  $('btn-leaderboard').addEventListener('click', () => { lbTab = 'global'; openLeaderboard(); });
  $('btn-groups').addEventListener('click', () => { show('screen-groups'); renderGroups(); });
  document.querySelectorAll('.btn-back').forEach(b =>
    b.addEventListener('click', () => { show('screen-home'); renderHome(); }));

  $('btn-redeem').addEventListener('click', () => { openModal('modal-redeem'); $('redeem-code').focus(); });
  $('form-redeem').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('redeem-code').value.trim().toUpperCase();
    if (code.length !== 6) { toast('Codes have 6 characters', 'error'); return; }
    try {
      const res = await Api.redeem(uuid, code);
      applyState(res.state);
      closeModals();
      $('redeem-code').value = '';
      toast(`+${res.added} ${res.added === 1 ? 'life' : 'lives'}!`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('btn-name').addEventListener('click', () => {
    $('name-input').value = user.name;
    openModal('modal-name');
    $('name-input').focus();
  });
  $('form-name').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('name-input').value.trim();
    if (!name) return;
    try {
      applyState(await Api.setName(uuid, name));
      closeModals();
      toast('Nickname saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('form-join').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 6) { toast('Group codes have 6 characters', 'error'); return; }
    try {
      applyState(await Api.joinGroup(uuid, code));
      $('join-code').value = '';
      renderGroups();
      toast('Joined group!', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('form-create').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('create-name').value.trim();
    if (!name) { toast('Give your group a name', 'error'); return; }
    try {
      const res = await Api.createGroup(uuid, name);
      applyState(res.state);
      $('create-name').value = '';
      renderGroups();
      toast(`Group created — code ${res.code}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  boot();
})();
