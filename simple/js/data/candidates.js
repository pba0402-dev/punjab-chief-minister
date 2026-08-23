/**
 * The cast, and what each of them is like.
 * ------------------------------------------------------------------
 * `js/data/avatars.js` says which faces exist. This says what choosing one
 * means: how well known they are, how clean their reputation is, how they
 * lead, how hard they campaign, and — the one that matters most — where in
 * Punjab they are already strong.
 *
 * Every number here is a *game* number. None of it describes any real person,
 * and the ten characters are the game's own invention. They are written down
 * rather than generated so that they can be tuned: this file is the one place
 * to change how a candidate plays, and nothing else in the game holds a
 * second opinion about it.
 *
 * REGIONAL SUPPORT IS REAL
 *
 * `regionalSupport` is not decoration. 50 is neutral; above it a campaign in
 * that region buys more influence and below it less, through
 * `CMP.regionalMultiplier` — see js/engine/campaign.js, which is the only
 * place that applies it. So "where is my candidate strong" and "where is my
 * money worth more" are the same question, which is the whole reason the
 * setup screen shows it before the election starts.
 *
 * The swing is deliberately modest. A candidate is an advantage, not a
 * result: at the extremes the same rupee buys 20% more or 20% less, which is
 * enough to make the choice worth thinking about and not enough to decide an
 * election on its own.
 *
 * GRANT POTENTIAL IS NOT WIRED IN
 *
 * `grantPotential` lives in js/data/grants-config.js, deliberately apart from
 * this file and from today's grant rules, because the grant system is going
 * to be redesigned. Nothing reads it except the screens that show it.
 */
window.CMP = window.CMP || {};

/** Neutral, in the units regionalSupport is written in. */
CMP.REGION_NEUTRAL = 50;

/**
 * How much a region's support is worth to a campaign there.
 *
 * A 100 buys a fifth more influence, a 0 buys a fifth less, and 50 changes
 * nothing. Bounded on both sides so a bad draw is never hopeless and a good
 * one is never enough by itself.
 */
CMP.REGION_SWING = 0.2;

CMP.CANDIDATE_STATS = {
  a1: {
    label: 'The organiser',
    blurb: 'Built the machine seat by seat. Nothing flashy, nothing wasted.',
    popularity: 61, corruption: 14, leadership: 74, campaignStrength: 79,
    regionalSupport: { majha: 48, doaba: 55, malwa: 71 },
  },
  a2: {
    label: 'The reformer',
    blurb: 'Ran on cleaning it up and has the record to be believed.',
    popularity: 68, corruption: 8, leadership: 66, campaignStrength: 58,
    regionalSupport: { majha: 72, doaba: 61, malwa: 44 },
  },
  a3: {
    label: 'The veteran',
    blurb: 'Four decades of it. Knows every district and every grudge.',
    popularity: 74, corruption: 38, leadership: 82, campaignStrength: 51,
    regionalSupport: { majha: 66, doaba: 47, malwa: 63 },
  },
  a4: {
    label: 'The farmer’s voice',
    blurb: 'Came out of the union halls and never quite left them.',
    popularity: 71, corruption: 19, leadership: 58, campaignStrength: 73,
    regionalSupport: { majha: 43, doaba: 52, malwa: 84 },
  },
  a5: {
    label: 'The technocrat',
    blurb: 'Ran the department before running for it. Reads the numbers.',
    popularity: 52, corruption: 11, leadership: 77, campaignStrength: 62,
    regionalSupport: { majha: 57, doaba: 76, malwa: 49 },
  },
  a6: {
    label: 'The orator',
    blurb: 'Fills a ground anywhere. What happens after is somebody else’s job.',
    popularity: 83, corruption: 31, leadership: 54, campaignStrength: 86,
    regionalSupport: { majha: 61, doaba: 58, malwa: 60 },
  },
  a7: {
    label: 'The elder',
    blurb: 'Spoken of with respect in every district, including by opponents.',
    popularity: 69, corruption: 9, leadership: 88, campaignStrength: 44,
    regionalSupport: { majha: 78, doaba: 54, malwa: 51 },
  },
  a8: {
    label: 'The city hand',
    blurb: 'Made their name in the towns and has never lost one.',
    popularity: 64, corruption: 26, leadership: 63, campaignStrength: 76,
    regionalSupport: { majha: 55, doaba: 81, malwa: 46 },
  },
  a9: {
    label: 'The outsider',
    blurb: 'No machine behind them, and no favours owed to anyone.',
    popularity: 47, corruption: 6, leadership: 69, campaignStrength: 81,
    regionalSupport: { majha: 52, doaba: 63, malwa: 58 },
  },
  a10: {
    label: 'The fixer',
    blurb: 'Gets things done. People are careful about asking how.',
    popularity: 58, corruption: 47, leadership: 71, campaignStrength: 88,
    regionalSupport: { majha: 64, doaba: 44, malwa: 69 },
  },
};

/**
 * What a face is worth, with a safe answer for one nobody wrote down.
 *
 * A profile stores an avatar id, so an id from a future list — or a corrupted
 * save — must not be able to crash a setup screen. The fallback is neutral
 * everywhere: an unknown candidate is neither an advantage nor a penalty.
 */
CMP.candidateStats = function (avatarId) {
  var found = CMP.CANDIDATE_STATS[String(avatarId)];
  if (found) return found;
  return {
    label: 'Candidate',
    blurb: '',
    popularity: 50,
    corruption: 25,
    leadership: 50,
    campaignStrength: 50,
    regionalSupport: { majha: 50, doaba: 50, malwa: 50 },
  };
};

/**
 * What a campaign in this region is multiplied by, for this candidate.
 *
 * The single point of contact between this file and the engine. Anything
 * outside a sane range is treated as neutral rather than trusted, because a
 * bad number here would otherwise reach the board.
 */
CMP.regionalMultiplier = function (avatarId, regionId) {
  if (!regionId) return 1;
  var support = CMP.candidateStats(avatarId).regionalSupport || {};
  var value = Number(support[regionId]);
  if (!isFinite(value) || value < 0 || value > 100) return 1;
  return 1 + ((value - CMP.REGION_NEUTRAL) / CMP.REGION_NEUTRAL) * CMP.REGION_SWING;
};

/**
 * The regions ranked, strongest first.
 *
 * Derived every time rather than stored, so "strongest" and "weakest" cannot
 * drift away from the numbers they are supposed to describe — change a value
 * above and the labels follow on the next render.
 */
CMP.regionalRanking = function (avatarId) {
  var support = CMP.candidateStats(avatarId).regionalSupport || {};
  return (CMP.REGIONS || []).map(function (region) {
    return {
      id: region.id,
      name: region.name,
      value: Number(support[region.id]) || 0,
    };
  }).sort(function (a, b) {
    return b.value - a.value;
  });
};

/**
 * Which regions to call strong, and which to call weak.
 *
 * Strong is "above neutral", not "the top two" — a candidate who is even
 * everywhere has no strong region, and saying they do would be inventing an
 * advantage. Weak is the lowest, and only when it is genuinely below neutral.
 */
CMP.regionalSummary = function (avatarId) {
  var ranked = CMP.regionalRanking(avatarId);
  var strong = ranked.filter(function (r) {
    return r.value > CMP.REGION_NEUTRAL;
  });
  var last = ranked[ranked.length - 1];
  return {
    ranked: ranked,
    strongest: strong,
    weakest: last && last.value < CMP.REGION_NEUTRAL ? last : null,
    even: strong.length === 0,
  };
};
