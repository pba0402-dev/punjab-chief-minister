/**
 * Which picture each id is shown as.
 *
 * The ids are the game's own and never change — a save, a profile and the
 * server's dealing of faces to opponents have all stored them since the first
 * game anybody played here. The filenames are the asset package's and are
 * never renamed. This file is the join between the two, so re-pointing an id
 * at a different picture is one line and no code change.
 *
 * An id with no entry falls back to <id>.png, and an id with no file at all
 * falls back to a label rather than to a broken image.
 *
 * `symbols` below is an approved mapping, agreed deliberately rather than
 * derived. `portraits` is still the sync tool's guess from the order in the
 * package's own JSON, and has not been agreed.
 *
 * Note: `tools/sync-assets.mjs` rewrites this whole file. Running it again
 * would re-derive both halves and discard what is approved here.
 */
window.CMP = window.CMP || {};

CMP.ASSET_MAP = {
  "portraits": {
    "a1": "arvind-kejriwal.png",
    "a2": "bhagwant-mann.png",
    "a3": "captain-amarinder.png",
    "a4": "charanjit-channi.png",
    "a5": "narendra-modi.png",
    "a6": "navjot-sidhu.png",
    "a7": "parkash-badal.png",
    "a8": "partap-bajwa.png",
    "a9": "raja-warring.png",
    "a10": "sukhbir-badal.png"
  },

  "symbols": {
    "star": "aap.png",
    "tree": "bjp.png",
    "lion": "inc.png",
    "sunrise": "sad.png",
    "mountain": "lok.png",
    "wheel": "jsp.png"
  }
};
