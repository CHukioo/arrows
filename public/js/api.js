/* Thin fetch wrapper for the backend API. */
(function () {
  'use strict';

  async function call(method, url, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.Api = {
    initUser: (uuid, name) => call('POST', '/api/user/init', { uuid, name }),
    setName: (uuid, name) => call('POST', '/api/user/name', { uuid, name }),
    completeLevel: (uuid, level, heartsLeft) => call('POST', '/api/level/complete', { uuid, level, heartsLeft }),
    failLevel: uuid => call('POST', '/api/level/fail', { uuid }),
    redeem: (uuid, code) => call('POST', '/api/redeem', { uuid, code }),
    createGroup: (uuid, name) => call('POST', '/api/group/create', { uuid, name }),
    joinGroup: (uuid, code) => call('POST', '/api/group/join', { uuid, code }),
    leaveGroup: (uuid, code) => call('POST', '/api/group/leave', { uuid, code }),
    leaderboard: uuid => call('GET', `/api/leaderboard?uuid=${encodeURIComponent(uuid)}`),
    groupLeaderboard: (code, uuid) => call('GET', `/api/group/${encodeURIComponent(code)}/leaderboard?uuid=${encodeURIComponent(uuid)}`)
  };
})();
