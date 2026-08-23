/**
 * Sound.
 * ------------------------------------------------------------------
 * Two channels — background music and one-off effects — each with its own
 * switch and its own volume, both remembered between games by `CMP.settings`.
 *
 * Nothing plays until somebody has touched the page. That is not politeness:
 * a browser refuses audio started before a gesture, and a game that tries
 * anyway spends its first seconds throwing errors into the console. So the
 * first real interaction is what starts the music, and everything before it
 * is queued or dropped.
 *
 * It is also honest about having no files. `CMP.audio.ready()` says whether
 * any arrived; the settings screen reads it and says so plainly rather than
 * offering switches that quietly do nothing. Drop files into
 * `assets/audio/music/` and `assets/audio/sfx/` named as `TRACKS` and `CUES`
 * below and they start working with no code change.
 */
window.CMP = window.CMP || {};

CMP.audio = (function () {
  'use strict';

  var BASE = 'assets/audio/';

  /** The one loop, and the cues that play over it. */
  var TRACKS = { theme: 'theme' };

  var CUES = {
    tap: 'tap',                 // any button
    select: 'select',           // a party, a candidate, a district
    invest: 'invest',           // money into a seat
    loan: 'loan',
    grant: 'grant',
    alliance: 'alliance',
    won: 'won',                 // a seat taken for good
    results: 'results',         // the round being read out
    victory: 'victory',
  };

  /*
   * Ordered by preference. A browser plays the first it understands, so a
   * package of .ogg works, a package of .mp3 works, and a mixture works.
   */
  var TYPES = [
    { ext: '.mp3', mime: 'audio/mpeg' },
    { ext: '.ogg', mime: 'audio/ogg' },
    { ext: '.m4a', mime: 'audio/mp4' },
    { ext: '.wav', mime: 'audio/wav' },
  ];

  var unlocked = false;
  var music = null;
  var musicWanted = false;
  var cache = {};
  var missing = {};

  function canPlay() {
    try {
      return typeof window.Audio === 'function';
    } catch (e) {
      return false;
    }
  }

  /** Which extension this browser will accept, or null if none. */
  function pickType() {
    if (!canPlay()) return null;
    var probe;
    try {
      probe = new window.Audio();
    } catch (e) {
      return null;
    }
    if (!probe.canPlayType) return TYPES[0];
    for (var i = 0; i < TYPES.length; i++) {
      if (probe.canPlayType(TYPES[i].mime)) return TYPES[i];
    }
    return null;
  }

  var type = null;
  function ext() {
    if (type === null) type = pickType() || { ext: '.mp3' };
    return type.ext;
  }

  function url(kind, name) {
    return BASE + kind + '/' + name + ext();
  }

  /** Volume 0-1 for a channel, from what the player asked for. */
  function volumeOf(channel) {
    var pref = CMP.settings.get(channel === 'music' ? 'musicVolume' : 'soundVolume');
    var value = typeof pref === 'number' ? pref : 0.6;
    return Math.max(0, Math.min(1, value));
  }

  function enabled(channel) {
    return !!CMP.settings.get(channel === 'music' ? 'music' : 'sound');
  }

  /* --------------------------------------------------------- the cues */

  function element(kind, name) {
    var key = kind + '/' + name;
    if (missing[key]) return null;
    if (cache[key]) return cache[key];
    if (!canPlay()) return null;

    var node;
    try {
      node = new window.Audio(url(kind, name));
    } catch (e) {
      missing[key] = true;
      return null;
    }
    node.preload = 'auto';
    // A file that is not there is a fact about this installation, not an
    // error worth repeating on every tap.
    node.addEventListener('error', function () {
      missing[key] = true;
    });
    cache[key] = node;
    return node;
  }

  /**
   * Play one effect.
   *
   * Silently does nothing before the first interaction, when the channel is
   * off, or when the file is not installed — none of which is a failure the
   * player should hear about.
   */
  function play(cue) {
    if (!unlocked || !enabled('sound')) return;
    var name = CUES[cue];
    if (!name) return;

    var node = element('sfx', name);
    if (!node) return;

    try {
      // Cloned so a rapid sequence overlaps rather than restarting one node.
      var voice = node.cloneNode();
      voice.volume = volumeOf('sound');
      var playing = voice.play();
      if (playing && playing.catch) playing.catch(function () {});
    } catch (e) {
      /* a cue that will not play is not worth interrupting a game for */
    }
  }

  /* -------------------------------------------------------- the music */

  function startMusic() {
    musicWanted = true;
    if (!unlocked || !enabled('music')) return;

    if (!music) {
      music = element('music', TRACKS.theme);
      if (!music) return;
      music.loop = true;
    }
    music.volume = volumeOf('music');
    try {
      var playing = music.play();
      if (playing && playing.catch) playing.catch(function () {});
    } catch (e) {
      /* refused, which is the browser's right */
    }
  }

  function stopMusic() {
    if (!music) return;
    try {
      music.pause();
    } catch (e) {
      /* already stopped */
    }
  }

  /**
   * The first real interaction, which is when a browser will let sound play.
   *
   * Bound once and removed as soon as it fires, so the page is not carrying
   * three listeners for the rest of the game.
   */
  function listenForFirstTouch() {
    if (!canPlay()) return;

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (name) {
        document.removeEventListener(name, unlock, true);
      });
      if (musicWanted) startMusic();
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (name) {
      document.addEventListener(name, unlock, true);
    });
  }

  /** True once any audio file has actually loaded. */
  function ready() {
    var any = false;
    Object.keys(cache).forEach(function (key) {
      var node = cache[key];
      if (!missing[key] && node && node.readyState > 0) any = true;
    });
    return any;
  }

  /** Whether a file for this cue was found, for the settings screen to report. */
  function installed(kind, name) {
    return !missing[kind + '/' + name];
  }

  // A change of preference takes effect at once rather than at the next
  // screen: somebody turning music off wants it to stop now.
  CMP.settings.onChange(function (key, value) {
    if (key === 'music') {
      if (value) startMusic();
      else stopMusic();
    }
    if (key === 'musicVolume' && music) music.volume = volumeOf('music');
  });

  listenForFirstTouch();

  return {
    play: play,
    startMusic: startMusic,
    stopMusic: stopMusic,
    ready: ready,
    installed: installed,
    cues: Object.keys(CUES),
    isUnlocked: function () {
      return unlocked;
    },
  };
})();
