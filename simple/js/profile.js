/**
 * Who the player is, between games.
 * ------------------------------------------------------------------
 * The browser holds an id and a chosen name; the server holds everything that
 * accumulates — elections played, won, seats, achievements, level.
 *
 * The id is generated here on first run and kept in localStorage. That is a
 * deliberately low bar: this is a game, and asking somebody to make an account
 * before they can find out whether they enjoy it would cost more players than
 * it protects. What it buys is that a profile carries no email, no phone
 * number, and nothing at all the player did not choose to type.
 *
 * Nothing here is required to play. A player with no profile can start a game
 * immediately; the profile simply has nothing to remember about them.
 */
window.CMP = window.CMP || {};

CMP.profile = (function () {
  'use strict';

  var KEY = 'cmp.punjab.profile.v1';
  var local = null;   // { id, name, portraitSeed }
  var remote = null;  // the server's view, once fetched
  var listeners = [];

  function read() {
    if (local) return local;
    try {
      var raw = window.localStorage.getItem(KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.id) local = saved;
    } catch (e) {
      local = null;
    }
    return local;
  }

  function write(next) {
    local = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      /* private mode — the profile just will not survive a refresh */
    }
    emit();
  }

  /** A 32-character hex id, from the best randomness the browser offers. */
  function newId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map
      .call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }

  /**
   * Start a profile under a chosen name.
   *
   * The portrait seed is generated separately from the id and never derived
   * from it. The seed is published — it is on every leaderboard row, because
   * that is how the face gets drawn — and the id is what proves a request is
   * yours. Making one from the other would put every player's id on the
   * leaderboard for anybody to read.
   */
  function create(name) {
    write({
      id: newId(),
      name: String(name || '').trim().slice(0, 32) || 'Player',
      portraitSeed: newId(),
    });
    return local;
  }

  function rename(name) {
    var p = read();
    if (!p) return create(name);
    write({ id: p.id, name: String(name || '').trim().slice(0, 32) || p.name, portraitSeed: p.portraitSeed });
    return local;
  }

  function has() {
    return !!read();
  }

  function stats() {
    return remote;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn(local, remote);
      } catch (e) {
        if (window.console) window.console.error(e);
      }
    });
  }

  /** Fetch the server's view. Resolves to null when there is no profile yet. */
  function refresh() {
    var p = read();
    if (!p) return Promise.resolve(null);
    return CMP.net.profile(p.id, p.name, p.portraitSeed).then(function (res) {
      if (res && res.ok) {
        remote = res.profile;
        emit();
      }
      return remote;
    });
  }

  /**
   * Report a finished solo game. The server had no part in playing it, so it
   * is recorded as the player's own account: kept on their profile, never on
   * the leaderboard.
   */
  function recordSolo(game, result) {
    var p = read();
    if (!p || !result) return Promise.resolve(null);

    var mine = null;
    for (var i = 0; i < result.standings.length; i++) {
      if (result.standings[i].party === game.partyId) mine = result.standings[i];
    }
    if (!mine) return Promise.resolve(null);

    var behindAtTen = false;
    (game.history || []).forEach(function (snap) {
      if (snap.round !== 10) return;
      Object.keys(snap.seats).forEach(function (party) {
        if (party !== game.partyId && snap.seats[party] > (snap.seats[game.partyId] || 0)) {
          behindAtTen = true;
        }
      });
    });

    var usedHighRisk = (game.actions || []).some(function (a) {
      return a.group === 'risky';
    });

    return CMP.net
      .recordSolo({
        profileId: p.id,
        name: p.name,
        portraitSeed: p.portraitSeed,
        party: game.partyId,
        seats: mine.seats,
        won: !!(result.winner && result.winner.party === game.partyId),
        coalition: false,
        outcome: result.outcome,
        spent: game.spent,
        behindAtTen: behindAtTen,
        usedHighRisk: usedHighRisk,
      })
      .then(function (res) {
        if (res && res.ok && res.profile) {
          remote = res.profile;
          emit();
        }
        return remote;
      })
      .catch(function () {
        // Offline solo play is still play. Losing the record of it is a
        // smaller loss than refusing to let somebody finish their game.
        return null;
      });
  }

  /**
   * Drop the fetched record, keeping the identity.
   *
   * Only the tests use this, to open a screen the way somebody arriving cold
   * would see it rather than with the record already in hand.
   */
  function forget() {
    remote = null;
  }

  return {
    get: read,
    forget: forget,
    has: has,
    create: create,
    rename: rename,
    stats: stats,
    refresh: refresh,
    recordSolo: recordSolo,
    onChange: onChange,
  };
})();
