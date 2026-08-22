/**
 * The cast list.
 * ------------------------------------------------------------------
 * Which faces exist, as ids. What each one looks like lives in
 * `js/ui/portrait.js`, which draws them; the server keeps the same list in
 * `api/lib/AI.php` so it can deal a face to an opponent without knowing how
 * one is drawn.
 *
 * Three copies of one list is two too many to trust, so `npm run test:ai`
 * fails the build if they ever stop matching.
 *
 * The order is fixed and the list is append-only in practice: a stored profile
 * refers to an id, so moving one would change somebody's face.
 */
window.CMP = window.CMP || {};

CMP.AVATARS = [
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8',
  'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16',
  'a17', 'a18', 'a19', 'a20', 'a21', 'a22', 'a23', 'a24',
];

/**
 * A face for somebody who never opened the picker.
 *
 * Derived from whatever identifies them, so it is stable — the same player
 * gets the same suggestion every time rather than a new stranger on each
 * reload — but it is only a suggestion, and the picker overrides it.
 */
CMP.avatarFor = function (from) {
  var h = 0;
  var text = String(from || '');
  for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return CMP.AVATARS[h % CMP.AVATARS.length];
};

/**
 * A face nobody in this game is using yet.
 *
 * Opponents are dealt from here, so four candidates on a scoreboard are four
 * different people. A human who wants the same face as somebody else may still
 * choose it — the constraint is on what is dealt, not on what is chosen.
 */
CMP.avatarUnused = function (taken, from) {
  var used = {};
  (taken || []).forEach(function (id) {
    used[id] = true;
  });
  var free = CMP.AVATARS.filter(function (id) {
    return !used[id];
  });
  if (!free.length) return CMP.avatarFor(from);

  var h = 0;
  var text = String(from || '');
  for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return free[h % free.length];
};
