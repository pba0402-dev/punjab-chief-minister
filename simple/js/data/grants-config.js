/**
 * Grant potential, kept at arm's length.
 * ------------------------------------------------------------------
 * The grant system is going to be redesigned. This file exists so that when
 * it is, the screens that talk about grants do not have to be rebuilt with
 * it.
 *
 * WHAT THIS IS NOT
 *
 * It is not today's grant rules. Those live in the engine — a district you
 * lead outright pays its grant every round, and the money is locked to the
 * region that earned it — and nothing here changes, reads or duplicates them.
 * `CMP.campaign.grantIn()` is still the only answer to "how much grant money
 * do I actually have", and the screens ask it directly.
 *
 * WHAT THIS IS
 *
 * One question, asked one way: **how promising does this region look for
 * grants**, as a number out of a hundred. That is a judgement about
 * opportunity, not a balance, and it is the only thing the new screens read.
 *
 * WHEN THE REDESIGN COMES
 *
 * Replace `CMP.GRANT_CONFIG.potential` and nothing else. It is handed a
 * context object rather than a game, so a future rule can weigh whatever it
 * likes — rounds, districts held, alliances, campaign performance, party,
 * candidate — by asking for more of the context rather than by reaching into
 * the game from here. Anything it does not understand, it ignores.
 *
 * The shape of the context is documented on `potential` below and is additive
 * by design: new fields may be added, existing ones are not repurposed.
 */
window.CMP = window.CMP || {};

CMP.GRANT_CONFIG = {
  /*
   * Bumped when the shape of the context or the meaning of the answer
   * changes, so a future implementation can tell which contract it is being
   * called under rather than guessing.
   */
  version: 1,

  /** What the bands mean, for screens that would rather say a word. */
  bands: [
    { id: 'high', label: 'High', min: 66 },
    { id: 'medium', label: 'Medium', min: 40 },
    { id: 'low', label: 'Low', min: 0 },
  ],

  /**
   * How promising a region looks for grants, 0-100.
   *
   * ctx = {
   *   region:      'majha' | 'doaba' | 'malwa'
   *   avatar:      the candidate's face id, or null
   *   game:        the live game object, or null before one exists
   *   districts:   how many districts in the region the campaign holds
   *   districtsIn: how many districts the region has in total
   * }
   *
   * Today's answer is deliberately simple, and deliberately about the two
   * things a player can actually act on: a candidate who is strong in a
   * region is better placed to take districts there, and districts already
   * held are the ones already paying. It is an opportunity reading, not a
   * forecast, and it is not a rupee figure — the screens are careful to say
   * so, because a percentage that looked like money would be the one
   * misunderstanding worth avoiding.
   */
  potential: function (ctx) {
    var region = ctx && ctx.region;
    if (!region) return 0;

    // Where the candidate already stands, on the same 0-100 scale.
    var standing = 50;
    if (ctx.avatar && CMP.candidateStats) {
      var support = CMP.candidateStats(ctx.avatar).regionalSupport || {};
      var v = Number(support[region]);
      if (isFinite(v)) standing = v;
    }

    /*
     * Ground already held, as a share of the region.
     *
     * Districts are what pay, so holding some of a region is the strongest
     * signal there is that more of it is worth having. Before an election
     * starts this is zero for everybody, which is correct: nobody has an
     * advantage yet.
     */
    var total = Math.max(1, Number(ctx.districtsIn) || 1);
    var held = Math.max(0, Math.min(total, Number(ctx.districts) || 0));
    var holding = (held / total) * 100;

    var score = standing * 0.7 + holding * 0.3;
    return Math.max(0, Math.min(100, Math.round(score)));
  },
};

/**
 * The question, asked the short way.
 *
 * Everything that shows grant potential goes through here rather than calling
 * the config directly, so the day the config is replaced there is one call
 * site to check instead of a dozen.
 */
CMP.grantPotential = function (ctx) {
  try {
    var n = CMP.GRANT_CONFIG.potential(ctx || {});
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  } catch (e) {
    /*
     * A grant rule that throws must not take a screen down with it. The
     * screens treat zero as "no reading", which is the honest answer when the
     * thing that was supposed to produce one has failed.
     */
    return 0;
  }
};

/** High / Medium / Low, for somewhere a percentage would be too much detail. */
CMP.grantBand = function (value) {
  var bands = CMP.GRANT_CONFIG.bands || [];
  for (var i = 0; i < bands.length; i++) {
    if (value >= bands[i].min) return bands[i];
  }
  return bands[bands.length - 1] || { id: 'low', label: 'Low', min: 0 };
};

/**
 * The context for a region, assembled from the live game.
 *
 * One place that knows how to count districts held, so the callers stay
 * short and the counting cannot disagree between screens.
 */
CMP.grantContextFor = function (game, region, avatar) {
  var inRegion = (CMP.districtsInRegion ? CMP.districtsInRegion(region) : []) || [];
  var held = 0;

  if (game && CMP.campaign && CMP.campaign.districtsControlledBy) {
    var mine = CMP.campaign.districtsControlledBy(game, game.partyId) || [];
    held = mine.filter(function (d) {
      var id = d && (d.id || d);
      for (var i = 0; i < inRegion.length; i++) {
        if (inRegion[i].id === id) return true;
      }
      return false;
    }).length;
  }

  return {
    region: region,
    avatar: avatar || (game && game.avatar) || null,
    game: game || null,
    districts: held,
    districtsIn: inRegion.length,
  };
};
