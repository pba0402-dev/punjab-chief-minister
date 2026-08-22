/**
 * Multiplayer client.
 * ------------------------------------------------------------------
 * Talks to api/index.php and keeps a poll running while the player is in a
 * lobby. Shared hosting cannot hold a WebSocket open, so "realtime" here is a
 * short poll — which doubles as the heartbeat that keeps the player marked
 * connected on the server.
 *
 * Credentials (code + playerId + token) are kept in localStorage so closing
 * the tab and coming back rejoins the same seat rather than taking a new one.
 */
window.CMP = window.CMP || {};

CMP.net = (function () {
  'use strict';

  var ENDPOINT = 'api/index.php';
  var SESSION_KEY = 'cmp.punjab.session.v1';
  var POLL_MS = 2500;

  var pollTimer = null;
  var listeners = [];
  var lastError = null;

  /* ------------------------------------------------------ session store */

  function readSession() {
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.code && s.playerId && s.token ? s : null;
    } catch (e) {
      return null;
    }
  }

  function writeSession(s) {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {
      /* private mode — the session just will not survive a refresh */
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* nothing to do */
    }
  }

  /* ------------------------------------------------------ transport */

  /** What every failed request resolves to. Nothing here ever rejects. */
  function offline(why) {
    return {
      ok: false,
      offline: true,
      error: why || 'Cannot reach the game server. Check your connection.',
      code: 'offline',
    };
  }

  function request(action, payload, method) {
    // Solo play works with no server at all — from the filesystem, from a
    // test harness, from a phone with no signal. A missing fetch is that
    // case, not an error, so it resolves like any other failed request
    // rather than throwing out of a caller that never asked about network.
    if (typeof fetch !== 'function') {
      return Promise.resolve(offline('The game server is not available here.'));
    }

    var url = ENDPOINT + '?action=' + encodeURIComponent(action);
    var opts = { method: method || 'POST', headers: { 'Content-Type': 'application/json' } };

    if (opts.method === 'GET') {
      var parts = [];
      Object.keys(payload || {}).forEach(function (k) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]));
      });
      url += parts.length ? '&' + parts.join('&') : '';
      delete opts.headers;
      opts = { method: 'GET' };
    } else {
      opts.body = JSON.stringify(payload || {});
    }

    return fetch(url, opts)
      .then(function (res) {
        return res.json().then(function (json) {
          json.status = res.status;
          return json;
        });
      })
      .catch(function () {
        return offline();
      });
  }

  function authed(extra) {
    var s = readSession() || {};
    var payload = { code: s.code, playerId: s.playerId, token: s.token };
    Object.keys(extra || {}).forEach(function (k) {
      payload[k] = extra[k];
    });
    return payload;
  }

  /* ------------------------------------------------------ actions */

  function create(profile) {
    return request('create', {
      profileId: profile ? profile.id : null,
      profileName: profile ? profile.name : null,
    }).then(function (res) {
      if (res.ok) {
        writeSession({ code: res.code, playerId: res.playerId, token: res.token });
      }
      return res;
    });
  }

  function join(code, profile) {
    return request('join', {
      code: code,
      profileId: profile ? profile.id : null,
      profileName: profile ? profile.name : null,
    }).then(function (res) {
      if (res.ok) {
        writeSession({ code: res.code, playerId: res.playerId, token: res.token });
      }
      return res;
    });
  }

  function state() {
    return request('state', authed(), 'GET');
  }

  /**
   * Found or rename the party this player is standing for.
   *
   * The id is not sent: it is the slot they are sitting in, and the server
   * decides that. Everything else about the party is theirs.
   */
  function setParty(party) {
    party = party || {};
    return request('party', authed({
      name: party.name || '',
      short: party.short || '',
      symbol: party.symbol || '',
      colourId: party.colourId || '',
      slogan: party.slogan || '',
    }));
  }

  function setDetails(candidateName, slogan, profile) {
    // Budget is granted by the server, never submitted by the client.
    //
    // The profile rides along because this is the first point at which the
    // player has typed a name: a profile started in the lobby has to reach
    // the server somehow, or the election they are about to play is credited
    // to nobody.
    return request('details', authed({
      candidateName: candidateName,
      slogan: slogan,
      profileId: profile ? profile.id : '',
      profileName: profile ? profile.name : '',
    }));
  }

  /**
   * Play one campaign action. The server rolls the outcome, not us, and it
   * clamps the amount to what the action allows — a client cannot spend
   * outside the range by asking nicely.
   */
  function playAction(actionId, constituency, amount) {
    return request('campaign', authed({
      actionId: actionId,
      constituency: constituency,
      amount: amount,
    }));
  }

  /**
   * Ask the bank what a loan of this size would cost. A quote changes
   * nothing on the server, so the confirmation screen can show exact terms
   * before the player commits to them.
   */
  function loanQuote(amount) {
    return request('loan', authed({ amount: amount, quote: true }));
  }

  /** Take the loan. The server re-checks the terms before granting it. */
  function takeLoan(amount) {
    return request('loan', authed({ amount: amount }));
  }

  /**
   * How one seat's race has moved, round by round. Fetched on demand rather
   * than polled, because fifteen full boards would dwarf everything else in
   * the response.
   */
  function seatHistory(constituency) {
    return request('history', authed({ constituency: constituency }), 'GET');
  }

  /* ------------------------------------------------------ profiles */

  /**
   * The home screen's figures: counters, the leaderboard and party
   * performance. All counted from games that actually finished — a new
   * installation answers zero, and the screen says zero.
   */
  /**
   * Count one thing that happened.
   *
   * Fire and forget: a failed count must never interrupt play, and nothing
   * downstream waits on the answer.
   */
  function track(event, extra) {
    var payload = { event: event };
    Object.keys(extra || {}).forEach(function (k) {
      payload[k] = extra[k];
    });
    try {
      request('track', payload).catch(function () {});
    } catch (e) {
      /* analytics are never worth an exception */
    }
  }

  function stats() {
    return request('stats', {}, 'GET');
  }

  /** Fetch a profile, creating it on first contact. */
  function profile(profileId, name, avatar) {
    return request('profile', {
      profileId: profileId,
      name: name,
      avatar: avatar,
    });
  }

  /**
   * Report a finished solo game. The server never saw it played, so it is
   * kept on the player's own profile and deliberately never reaches the
   * leaderboard — see api/lib/Profiles.php.
   */
  function recordSolo(payload) {
    return request('record', payload || {});
  }

  /** Report a rival. Each player may report each rival once. */
  function report(accusedId, reason) {
    return request('report', authed({ accusedId: accusedId, reason: reason }));
  }

  /** Host only: close the polls and count all 117 seats. */
  function declare() {
    return request('declare', authed());
  }

  /** Coalition talks: propose / accept / reject. */
  function coalition(payload) {
    return request('coalition', authed(payload || {}));
  }

  function setReady(ready) {
    return request('ready', authed({ ready: !!ready }));
  }

  /** Start the election. The host's chosen round length goes with it. */
  function start(roundSeconds) {
    return request('start', authed({ roundSeconds: roundSeconds || 0 }));
  }

  /** Declare yourself finished for this round. */
  function endRound() {
    return request('endround', authed());
  }

  /**
   * One sum across many seats. The server resolves each seat itself, so this
   * is not a way round the rules — only a way round fifteen separate taps.
   */
  function allocate(actionId, seats, amount) {
    return request('allocate', authed({
      actionId: actionId,
      seats: seats || [],
      amount: amount || 0,
    }));
  }

  /** Name the districts this campaign is prioritising. */
  function setPriority(districts) {
    return request('priority', authed({ districts: districts || [] }));
  }

  /** Offer, accept, decline or withdraw an alliance. */
  function ally(move, otherPlayerId) {
    return request('ally', authed({ move: move, playerId2: otherPlayerId }));
  }

  /**
   * Unfinished games this profile can walk back into.
   *
   * Asked of the server rather than read from this browser, so a player who
   * cleared their history, switched devices or lost their session still finds
   * their election.
   */
  function resumable(profileId) {
    if (!profileId) return Promise.resolve({ ok: true, games: [] });
    return request('resume', { profileId: profileId }, 'GET');
  }

  /** Adopt a session returned by resumable(), so the next call is authorised. */
  function adopt(entry) {
    writeSession({ code: entry.code, playerId: entry.playerId, token: entry.token });
    return entry;
  }

  /**
   * Step away, or finish for good.
   *
   * Stepping away clears this browser's session but leaves the seat, the
   * money and the position exactly as they were — the game is still there to
   * come back to. Ending is the confirmed decision, and the only thing that
   * takes the way back away.
   */
  function leave(forGood) {
    return request('leave', authed({ end: !!forGood })).then(function (res) {
      clearSession();
      return res;
    });
  }

  function health() {
    return request('health', {}, 'GET');
  }

  /* ------------------------------------------------------ polling */

  function emit(res) {
    listeners.forEach(function (fn) {
      try {
        fn(res);
      } catch (e) {
        if (window.console) window.console.error(e);
      }
    });
  }

  function tick() {
    state().then(function (res) {
      lastError = res.ok ? null : res;
      emit(res);
    });
  }

  function startPolling(onUpdate) {
    if (onUpdate && listeners.indexOf(onUpdate) === -1) listeners.push(onUpdate);
    if (pollTimer !== null) return;
    tick();
    pollTimer = window.setInterval(tick, POLL_MS);
  }

  function stopPolling(onUpdate) {
    if (onUpdate) {
      var i = listeners.indexOf(onUpdate);
      if (i !== -1) listeners.splice(i, 1);
    } else {
      listeners = [];
    }
    if (listeners.length === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** Poll once right now, e.g. straight after an action changed something. */
  function refresh() {
    tick();
  }

  return {
    POLL_MS: POLL_MS,
    create: create,
    join: join,
    state: state,
    setParty: setParty,
    setDetails: setDetails,
    playAction: playAction,
    loanQuote: loanQuote,
    takeLoan: takeLoan,
    seatHistory: seatHistory,
    stats: stats,
    track: track,
    profile: profile,
    recordSolo: recordSolo,
    report: report,
    declare: declare,
    coalition: coalition,
    setReady: setReady,
    start: start,
    resumable: resumable,
    adopt: adopt,
    endRound: endRound,
    allocate: allocate,
    setPriority: setPriority,
    ally: ally,
    leave: leave,
    health: health,
    startPolling: startPolling,
    stopPolling: stopPolling,
    refresh: refresh,
    getSession: readSession,
    clearSession: clearSession,
    lastError: function () {
      return lastError;
    },
  };
})();
