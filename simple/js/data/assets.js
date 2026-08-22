/**
 * Where the pictures live.
 * ------------------------------------------------------------------
 * Portraits and party symbols are image files now rather than drawings the
 * page builds for itself. This is the only place that knows where they are,
 * so moving them is one edit and nothing else in the game has an opinion.
 *
 * Paths are relative to the page. That is what makes the same build work from
 * a file:// checkout, from a dev server on a port, and from a subdirectory on
 * the live host — an absolute path would work in exactly one of those.
 *
 * The id is the key, not the filename. `a1` is what a save has stored since
 * the first game anybody played here, so it stays `a1` however the picture of
 * it is named or renamed. `map` below is where an id is pointed at a file that
 * is not simply the id: put an entry in, and nothing else changes.
 */
window.CMP = window.CMP || {};

CMP.ASSETS = {
  base: 'assets/',

  portraits: {
    dir: 'portraits/',
    ext: '.png',
    /*
     * id -> filename, by hand, for anything the sync tool got wrong.
     *
     * Empty is the normal state: an id resolves to `<id>.png`, or to whatever
     * `js/data/asset-map.js` says the installed package calls it. An entry
     * here beats both, and survives the next sync.
     */
    map: {},
  },

  symbols: {
    dir: 'party-symbols/',
    ext: '.png',
    map: {},
  },
};

/**
 * The URL for one asset, or null if the kind is unknown.
 *
 * @param kind  'portraits' or 'symbols'
 * @param id    the game's own id, e.g. 'a7' or 'tree'
 */
CMP.assetUrl = function (kind, id) {
  var group = CMP.ASSETS[kind];
  if (!group || id === null || id === undefined || id === '') return null;

  var key = String(id);
  /*
   * Three ways an id finds its picture, most specific first: an override
   * written here by hand, the mapping the sync tool generated from whatever
   * package was installed, and finally the id's own name. The last is the
   * one that needs no configuration at all — drop `a7.png` in and it works.
   */
  var generated = (CMP.ASSET_MAP || {})[kind] || {};
  var file = group.map[key] || generated[key] || key + group.ext;
  return CMP.ASSETS.base + group.dir + file;
};
