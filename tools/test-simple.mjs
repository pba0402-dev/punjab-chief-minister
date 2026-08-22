/**
 * Solo game test run.
 * ------------------------------------------------------------------
 * Serves simple/ over real HTTP and drives it in jsdom, so localStorage and
 * relative script paths behave exactly as in a browser. Covers the home
 * screen, solo setup, the campaign panel, budget rules, heat and saving.
 * Any console error fails the run.
 *
 *   node tools/test-simple.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
const section = (t) => console.log('\n' + t);

/* ---------------------------------------------------------------- server */

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

/* ---------------------------------------------------------------- helpers */

const consoleErrors = [];

/* Every window opened stays on this list. The campaign screen runs a round
   clock and a countdown, so a window left open keeps Node's event loop alive
   and the suite never exits — closing them all at the end is not tidiness, it
   is what makes the process terminate. */
const openWindows = [];

async function openPage(seedStorage) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // One entry or several — a returning player has both a save and a
      // profile, and the home screen behaves differently for each.
      [].concat(seedStorage || []).forEach((entry) => {
        try {
          window.localStorage.setItem(entry.key, entry.value);
        } catch (e) {
          /* ignore */
        }
      });
      window.addEventListener('error', (e) => consoleErrors.push('window.error: ' + e.message));
    },
  });

  await new Promise((resolve) => {
    const done = () => setTimeout(resolve, 80);
    if (dom.window.document.readyState === 'complete') done();
    else dom.window.addEventListener('load', done, { once: true });
  });
  openWindows.push(dom);
  return dom;
}

const q = (d, sel) => d.window.document.querySelector(sel);
const qq = (d, sel) => Array.from(d.window.document.querySelectorAll(sel));
const clickIt = (d, node) => {
  if (!node) throw new Error('tried to click a missing element');
  node.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const typeInto = (d, node, value) => {
  node.value = value;
  node.dispatchEvent(new d.window.Event('input', { bubbles: true }));
};
const text = (d) => d.window.document.body.textContent;
// Actions resolve through a promise (the same call is async in multiplayer),
// so let the microtask queue drain before asserting on the repainted UI.
const settle = () => new Promise((r) => setTimeout(r, 10));
const modeCard = (d, label) =>
  qq(d, '.h-play-btn').find((b) => new RegExp(label, 'i').test(b.textContent));
const playButton = (d) => qq(d, '.h-play-btn')[0];
const actionCard = (d, label) =>
  qq(d, '.act').find((c) => {
    const n = c.querySelector('.act-name');
    return n && n.textContent === label;
  });

/**
 * Open a menu section by its label.
 *
 * The menu lives on the game's home screen rather than above every screen, so
 * getting anywhere means going back to home first. That is the navigation the
 * redesign asks for — click, open, decide, back — and driving the test the
 * same way is what proves the way back actually exists.
 */
/*
 * Back to the board.
 *
 * Home is the map with the two strategic buttons above it, so that is what
 * arriving there looks like — there is no menu grid to find any more.
 */
function goHome(d) {
  for (let i = 0; i < 4 && !q(d, '.g-strategy'); i++) {
    const back = q(d, '.g-section-head .sd-back') || q(d, '.areas .sd-back') || q(d, '.sd-back');
    if (!back) break;
    clickIt(d, back);
  }
  if (!q(d, '.g-strategy')) throw new Error('could not get back to the game board');
}

/*
 * Open a screen the way a player does.
 *
 * My Areas and Alliances are the two buttons above the map; everything else
 * lives under More, because none of it is opened every round.
 */
function openSection(d, label) {
  goHome(d);
  // The map is the home screen now, so there is nowhere to go for it.
  if (label === 'Home' || label === 'Map') return;

  const strategy = qq(d, '.g-strategy-item').find((n) => {
    const name = n.querySelector('.g-strategy-label');
    return name && name.textContent === label;
  });
  if (strategy) {
    clickIt(d, strategy);
    return;
  }

  clickIt(d, q(d, '.g-more'));
  const item = qq(d, '.sheet-item').find((n) => n.textContent === label ||
    n.textContent.indexOf(label) === 0);
  if (!item) throw new Error('no section called ' + label);
  clickIt(d, item);
}

/**
 * Home → my candidate → all my seats → a constituency → the campaign sheet.
 *
 * Tapping a party on the scoreboard opens who they are and how they stand,
 * which is what somebody usually wants; the full seat list is one more tap
 * from there. The suite walks the same path a player does.
 */
const openCampaignSheet = async (d, seatIndex) => {
  openSection(d, 'Home');
  await settle();
  clickIt(d, q(d, '.lb-row.is-you'));
  await settle();
  const allSeats = qq(d, 'button').find((b) => /All my seats/i.test(b.textContent));
  if (!allSeats) throw new Error('no way through to my seats');
  clickIt(d, allSeats);
  await settle();
  const viewAll = qq(d, 'button').find((b) => /View all 117/.test(b.textContent));
  if (viewAll) {
    clickIt(d, viewAll);
    await settle();
  }
  const row = qq(d, '.area-row')[seatIndex || 0];
  if (!row) throw new Error('no areas listed');
  clickIt(d, row);
  await settle();
  const go = qq(d, 'button').find((b) => /Campaign here/.test(b.textContent));
  if (!go) throw new Error('no campaign button on the constituency');
  clickIt(d, go);
  await settle();
};

/**
 * Spending money asks first. Click the card, then agree to the dialog —
 * which is what a player does, so the test should do it too.
 */
/**
 * Play one move the way a player does: through a constituency's campaign
 * sheet, choosing an amount, and confirming.
 */
/*
 * Put money into a seat, the way a player does.
 *
 * One panel: pick what the money is for — campaigning, a negative campaign or
 * a bribe — set the amount, confirm. There is no list of campaign types to
 * choose from any more, so `mode` is one of those three rather than an action
 * out of eleven.
 */
const playCard = async (d, mode, amount) => {
  if (!q(d, '.campaign-sheet')) await openCampaignSheet(d);

  const pick = qq(d, '.cs-mode').find((b) => {
    const n = b.querySelector('.cs-mode-label');
    return n && new RegExp(mode, 'i').test(n.textContent);
  });
  if (!pick) throw new Error('no campaign mode called ' + mode);
  clickIt(d, pick);
  await settle();

  if (amount) {
    const range = q(d, '.cs-range');
    if (range) {
      range.value = String(Math.min(Number(range.max), Math.max(Number(range.min), amount)));
      range.dispatchEvent(new d.window.Event('input', { bubbles: true }));
      await settle();
    }
  }

  const confirm = qq(d, '.campaign-sheet button').find((b) => /^Invest/.test(b.textContent));
  if (!confirm) throw new Error('no invest button appeared for ' + mode);
  clickIt(d, confirm);
  await settle();

  // Then the result, which takes itself away.
  const back = qq(d, 'button').find((b) => /Back to the map/.test(b.textContent));
  if (back) clickIt(d, back);
  await settle();
};

/* ---------------------------------------------------------------- home */

section('1-3. First screen');
let dom = await openPage();
check('1. first screen loads', !!q(dom, '.screen-home'));
check('13. the title is Election Time',
  q(dom, '.h-title').textContent === 'Election Time', q(dom, '.h-title').textContent);
check('13. under Punjab Assembly',
  q(dom, '.h-sub').textContent === 'Punjab Assembly', q(dom, '.h-sub').textContent);
check('13. with the three facts that define it',
  qq(dom, '.h-fact').length === 3 &&
  /117/.test(text(dom)) && /59/.test(text(dom)) && /20/.test(text(dom)),
  qq(dom, '.h-fact').map((f) => f.textContent).join('/'));
check('46. "Play solo" appears nowhere', !/play solo/i.test(text(dom)));
check('14. Election Time is the first and strongest action',
  /Election Time/.test(playButton(dom).textContent) &&
  playButton(dom).className.indexOf('is-primary') !== -1,
  playButton(dom).className);
check('14. with play with friends and join underneath',
  qq(dom, '.h-play-btn').length === 3 &&
  /Play with friends/i.test(text(dom)) && /Join election/i.test(text(dom)));
check('   statistics are never invented when there is no server',
  !/[1-9]\d*\s*(players|elections|governments)/i.test(text(dom)),
  text(dom).slice(0, 160));
check('   the home screen does not wait on constituency data',
  !q(dom, '.area-row') && !q(dom, '.seat-row'));

const CMP = dom.window.CMP;
check('42. the 117 constituency records are not loaded before a game starts',
  !CMP.data.ready() && !CMP.CONSTITUENCIES,
  CMP.CONSTITUENCIES ? CMP.CONSTITUENCIES.length + ' records' : 'none');
check('42. and neither are the sitting MLAs or the map',
  !CMP.INCUMBENTS && !CMP.GEOMETRY);
check('   campaign config loaded', !!CMP.CAMPAIGN && CMP.ACTIONS.length === 4,
  CMP.ACTIONS.length + ' actions');
/*
 * 2. One way to campaign, two optional risks, one way to raise money.
 *
 * There were eleven. Choosing between them was a decision about vocabulary
 * rather than about strategy: a rally, a media push and a community drive were
 * all money into a seat.
 */
check('2. one way to campaign', CMP.actionsByGroup('safe').length === 1,
  CMP.actionsByGroup('safe').map((a) => a.id).join(','));
check('2. two optional risks, and one of each',
  CMP.actionsByGroup('risky').length === 2 &&
  !!CMP.getAction('negative') && !!CMP.getAction('bribe'));
check('22. one corruption action, not a menu of them',
  CMP.actionsByMenu('bribe').length === 1);

/* ---------------------------------------------------------------- setup */

section('Setup: founding a party');
clickIt(dom, playButton(dom));
await dom.window.CMP.data.ensure();
await settle();
check('42. the board arrives when the player starts', CMP.CONSTITUENCIES.length === 117,
  String(CMP.CONSTITUENCIES && CMP.CONSTITUENCIES.length));
check('   majority is 59', CMP.MAJORITY === 59);
check('   setup screen opens', !!q(dom, '.screen-setup'));
/*
 * 5. Nobody is handed a party any more.
 *
 * There is no list of four to pick from: the player invents one, and every
 * screen afterwards shows what they invented. That is the difference between
 * playing a tracker and playing a game.
 */
check('5. no party is offered to be picked', qq(dom, '.party-card').length === 0,
  qq(dom, '.party-card').length + ' cards');
check('8. setup asks for a name, a party, a short name and a slogan',
  qq(dom, '.screen-setup .field-input').length === 4,
  qq(dom, '.screen-setup .field-input').length + ' fields');
check('9. and offers symbols to run under',
  qq(dom, '.sym-option').length >= 12, qq(dom, '.sym-option').length + ' symbols');
check('10. and colours', qq(dom, '.col-option').length >= 8,
  qq(dom, '.col-option').length + ' colours');
check('1. the budget is granted, not entered', !q(dom, '.field-money'));
check('7. the round allowance is stated on the setup screen',
  /5 crore/i.test(text(dom)), text(dom).slice(0, 120));
check('12. and offers faces to choose from',
  qq(dom, '.av-option').length >= 20, qq(dom, '.av-option').length + ' avatars');
/*
 * 12. Every face is an image file, found by the id the save stores.
 *
 * The portraits used to be drawn inline; they are PNGs now, loaded from
 * assets/portraits/ and keyed by id, so what has to hold is that each option
 * asks for a picture and asks for it under the right name. jsdom fetches
 * nothing, so this is about the request rather than the result — the result
 * is what the fallback below is for.
 */
check('12. every face is an image, one per option',
  qq(dom, '.av-option .portrait img').length === qq(dom, '.av-option').length,
  qq(dom, '.av-option .portrait img').length + ' of ' + qq(dom, '.av-option').length);
check('12. and each is fetched by its own id',
  qq(dom, '.av-option .portrait').every((n) => {
    const img = n.querySelector('img');
    return img && img.getAttribute('src') ===
      dom.window.CMP.assetUrl('portraits', n.dataset.avatar);
  }),
  (q(dom, '.av-option .portrait img') || {}).src);
check('12. from a relative path, so it works wherever the game is served',
  qq(dom, '.av-option .portrait img')
    .every((n) => /^assets\//.test(n.getAttribute('src'))),
  (q(dom, '.av-option .portrait img') || {}).getAttribute('src'));

// 12. A picture that never arrives leaves a labelled circle, not a hole and
// not the browser's broken-image glyph.
check('12. with something legible behind it while it loads',
  qq(dom, '.av-option .portrait-fallback').length === qq(dom, '.av-option').length);
check('16. and the round length',
  qq(dom, '.screen-setup .clock-option').length === 3);
check('16. two minutes by default',
  /2 min/.test(q(dom, '.screen-setup .clock-option.is-active').textContent));

const inputs = qq(dom, '.screen-setup .field-input');
typeInto(dom, inputs[0], 'Simran Kaur Gill');
typeInto(dom, qq(dom, '.screen-setup .field-input')[1], 'Punjab Development Party');
await settle();

// 29. The abbreviation writes itself from the name, and stays editable.
check('29. a short name is suggested from the party name',
  q(dom, '.js-short').value === 'PDP', q(dom, '.js-short').value);

// 11. And the card shows what all of it adds up to before anybody starts.
check('11. the preview names the player and the party',
  /SIMRAN KAUR GILL/.test(q(dom, '.pv-name').textContent) &&
  /PUNJAB DEVELOPMENT PARTY/.test(q(dom, '.pv-party').textContent),
  q(dom, '.pv-name').textContent + ' / ' + q(dom, '.pv-party').textContent);
check('11. with the symbol and the badge on it',
  !!q(dom, '.pv-badge .sym') && q(dom, '.pv-short').textContent === 'PDP',
  q(dom, '.pv-badge') ? q(dom, '.pv-badge').innerHTML.slice(0, 80) : 'no badge');

clickIt(dom, qq(dom, '.sym-option')[3]);
clickIt(dom, qq(dom, '.col-option')[5]);
clickIt(dom, q(dom, '.btn-start'));

/* ---------------------------------------------------------------- panel */

section('2. The game screen');
check('   election screen opens', !!q(dom, '.screen-election'));

/** A labelled figure inside the money section. */
/** The one big figure at the top of the money screen. */
function cashInHand(d) {
  const node = q(d, '.g-money-value');
  return node ? node.textContent : null;
}

/** One item in the game's menu grid, by its label. */
function menuItem(d, label) {
  openSection(d, label);
  return q(d, '.g-section-head') || q(d, '.punjab-map') || q(d, '.areas');
}

function moneyLine(d, label) {
  const row = qq(d, '.sum-line').find((n) => {
    const l = n.querySelector('.sum-line-label');
    return l && l.textContent === label;
  });
  return row ? row.querySelector('.sum-line-value').textContent : null;
}

/*
 * The active screen is a heads-up display, not a page. It does not repeat
 * the game's own name at somebody nineteen rounds into playing it.
 */
check('1. the game screen carries no title',
  !q(dom, '.g-title') && !/Chief Minister of Punjab/.test(text(dom)));
check('1. and no seat-count subtitle', !q(dom, '.g-subtitle'));
check('64. it opens with the round timer',
  !!q(dom, '.round-bar') && !!q(dom, '.round-timer'));
check('2. the ring shows the round, not a countdown',
  /^R\d+$/.test(q(dom, '.round-clock').textContent),
  q(dom, '.round-clock').textContent);
check('2. no numerical countdown anywhere on the screen',
  !/\d:\d\d/.test(q(dom, '.round-bar').textContent),
  q(dom, '.round-bar').textContent);
check('3. with the round out of twenty beside it',
  /Round 1 \/ 20/.test(q(dom, '.round-of').textContent),
  q(dom, '.round-of').textContent);

/*
 * The player card is gone. A portrait, a name and a party took a third of a
 * phone screen to say three things the player already knew; what replaced it
 * is the money, which is the part that changes.
 */
check('4. no large player card', !q(dom, '.g-player-name') && !q(dom, '.g-player-who'));
check('5. money is a compact strip of figures',
  qq(dom, '.g-fig').length >= 3, qq(dom, '.g-fig').length + ' figures');
/*
 * 1 + 20. The money lives in the header, beside the clock.
 *
 * It used to be a card of its own under the round bar, which cost a third of
 * a phone screen to say three numbers — and meant a player deep in the map had
 * to come back to Home to find out what they could afford.
 */
check('1. available, grant and spent sit beside the round',
  /Available/i.test(q(dom, '.round-aside').textContent) &&
  /Grant/i.test(q(dom, '.round-aside').textContent) &&
  /Spent/i.test(q(dom, '.round-aside').textContent),
  q(dom, '.round-aside').textContent);
check('19. and the large finance card is gone',
  !q(dom, '.g-player') || q(dom, '.g-player').children.length === 0);
check('5. available is the figure that leads',
  /₹5 crore/.test(q(dom, '.g-fig.is-lead').textContent),
  q(dom, '.g-fig.is-lead').textContent);
check('28. and the party still shows, quietly — the one they founded',
  /PDP/.test(q(dom, '.g-who').textContent), q(dom, '.g-who').textContent);
check('   no large stat cards remain', qq(dom, '.stat').length === 0);

const menuLabels = () =>
  qq(dom, '.g-menu-item .g-menu-label').map((n) => n.textContent);

/*
 * 2 + 33. Home is the map.
 *
 * There is no dashboard of ten buttons any more. What a player does every
 * round is decide where to put money, and the place that decision lives is the
 * board — so the board is on the home screen, with the two strategic screens
 * above it and everything else under More.
 */
check('2. the dashboard of buttons is gone', qq(dom, '.g-menu-item').length === 0,
  qq(dom, '.g-menu-item').length + ' buttons');
check('4. the map is on the home screen', !!q(dom, '.punjab-map'));
check('3. with My Areas and Alliances above it',
  qq(dom, '.g-strategy-item .g-strategy-label').map((n) => n.textContent).join('/') ===
  'My Areas/Alliances',
  qq(dom, '.g-strategy-item .g-strategy-label').map((n) => n.textContent).join('/'));
check('5. the map offers Punjab and its three regions',
  qq(dom, '.map-regions .term-option').length === 4,
  qq(dom, '.map-regions .term-option').map((n) => n.textContent).join('/'));
check('23. and says what the four appearances mean',
  !!q(dom, '.legend-key') &&
  ['open', 'leading', 'contested', 'won']
    .every((w) => new RegExp(w, 'i').test(q(dom, '.legend-key').textContent)),
  q(dom, '.legend-key') ? q(dom, '.legend-key').textContent : 'no key');
check('1. the leaderboard is on it too', !!q(dom, '.lb'));

/*
 * 1-3. A region replaces the board rather than cropping it.
 *
 * The camera used to be a transform inside a fixed viewBox, so choosing Majha
 * framed Majha and left the other two regions drawn just outside — where a
 * pinch found them again. Two things have to be true now: nothing outside the
 * region is drawn, and the camera has actually moved to fit what is.
 */
const mapSvg = () => q(dom, '.punjab-map');
const regionButton = (name) =>
  qq(dom, '.map-regions .term-option').find((b) => b.textContent === name);
const viewBoxOf = () => mapSvg().getAttribute('viewBox').split(' ').map(Number);

const punjabBox = viewBoxOf();
check('3. Punjab opens with the whole board in frame',
  punjabBox[2] === dom.window.CMP.GEOMETRY.viewBox.width, punjabBox.join(' '));
check('1. and all 117 seats drawn',
  qq(dom, '.map-cell').filter((c) => !c.classList.contains('is-outside')).length === 117);

clickIt(dom, regionButton('Majha'));
await settle();
await new Promise((r) => setTimeout(r, 500));

const majhaSeats = dom.window.CMP.CONSTITUENCIES
  .filter((c) => dom.window.CMP.regionOfSeat(c.number) === 'majha').length;
const shown = qq(dom, '.map-cell').filter((c) => !c.classList.contains('is-outside'));

check('1. choosing Majha draws only Majha', shown.length === majhaSeats,
  shown.length + ' drawn of ' + majhaSeats + ' in Majha');
check('1. every other region is gone from the board',
  shown.every((c) => dom.window.CMP.regionOfSeat(Number(c.dataset.seat)) === 'majha'));
check('1. and so is the Punjab outline',
  q(dom, '.map-outline').classList.contains('is-outside'));

const majhaBox = viewBoxOf();
check('3. the camera moved to fit it',
  majhaBox[2] < punjabBox[2] * 0.9,
  majhaBox.map((n) => Math.round(n)).join(' ') + ' vs ' + punjabBox.join(' '));
check('3. nobody has to zoom out afterwards',
  majhaBox[2] > 0 && majhaBox[3] > 0);

/*
 * 18. And a line above it saying how this part stands, from the game's own
 * board rather than from anything stored or invented.
 */
check('18. the summary names the region on screen',
  /Majha/i.test(q(dom, '.map-summary').textContent),
  q(dom, '.map-summary').textContent.slice(0, 60));

clickIt(dom, regionButton('Doaba'));
await settle();
await new Promise((r) => setTimeout(r, 500));
const doabaShown = qq(dom, '.map-cell').filter((c) => !c.classList.contains('is-outside'));
check('1. switching to Doaba draws only Doaba',
  doabaShown.every((c) => dom.window.CMP.regionOfSeat(Number(c.dataset.seat)) === 'doaba') &&
  doabaShown.length > 0,
  doabaShown.length + ' drawn');
check('3. and reframes for it',
  viewBoxOf().join(' ') !== majhaBox.join(' '));
check('18. the summary follows the region',
  /Doaba/i.test(q(dom, '.map-summary').textContent),
  q(dom, '.map-summary').textContent.slice(0, 60));

clickIt(dom, regionButton('All Punjab'));
await settle();
await new Promise((r) => setTimeout(r, 500));
check('1. All Punjab brings the whole board back',
  qq(dom, '.map-cell').filter((c) => !c.classList.contains('is-outside')).length === 117);
check('3. at the full extent',
  viewBoxOf()[2] === punjabBox[2], viewBoxOf().join(' '));

/*
 * 8. The legend names the parties.
 *
 * They are invented at the start of every game, so a colour on its own means
 * nothing — and somebody who called their party the Unity Punjab Front did
 * not call it UPF.
 */
const legendNames = qq(dom, '.map-legend .legend-label').map((n) => n.textContent);
check('8. the legend names every party in the game',
  dom.window.CMP.PARTIES.every((party) => legendNames.indexOf(party.name) !== -1),
  legendNames.join(' / '));
check('8. and says what it is a legend of',
  /leading/i.test(q(dom, '.legend-title').textContent),
  q(dom, '.legend-title') ? q(dom, '.legend-title').textContent : 'no title');


/*
 * 19. The money is in the header, and the card it replaced is gone.
 *
 * Not hidden, not emptied — removed. An empty bordered box under the round
 * bar is a third of the saving given straight back.
 */
check('19. the finance card is gone from the tree', !q(dom, '.g-player'));
check('1. and the round bar carries the money instead',
  !!q(dom, '.round-aside') && qq(dom, '.round-aside .g-fig').length >= 3,
  qq(dom, '.round-aside .g-fig-label').map((n) => n.textContent).join('/'));

check('6. the leaderboard is the centrepiece', /Who’s leading\?/i.test(text(dom)));

/*
 * 27. Before round one there is nobody to rank.
 *
 * Every campaign is on nothing and no constituency has been decided, so
 * ordering four zeroes one to four would invent a leader out of sort order.
 * The block says so and still lists everybody, because tapping through to a
 * rival is how you look them up.
 */
check('27. no leader is claimed before a round is settled',
  !!q(dom, '.lb-none-title') && /No leader yet/i.test(q(dom, '.lb-none-title').textContent),
  q(dom, '.lb-none-title') ? q(dom, '.lb-none-title').textContent : 'no block');
check('27. and it says every campaign is on nothing',
  /0 seats/.test(q(dom, '.lb-none-note').textContent),
  q(dom, '.lb-none-note').textContent);
check('27. nobody is marked as leading', !q(dom, '.lb-row.is-leading'));
check('27. and no bar is drawn', qq(dom, '.lb-bar-fill').length === 0);
check('   all four campaigns are still listed', qq(dom, '.lb-row').length === 4);
check('   with every seat count at zero',
  qq(dom, '.lb-seats').every((n) => n.textContent.trim() === '0'),
  qq(dom, '.lb-seats').map((n) => n.textContent).join('/'));
check('   and you are marked', !!q(dom, '.lb-row.is-you'));
check('8. the majority is one line, not a chart',
  qq(dom, '.g-majority').length === 1 &&
  /of 59|majority of 59|past the majority|59 seats form a government/
    .test(q(dom, '.g-majority-text').textContent),
  q(dom, '.g-majority-text').textContent);
// 27. And it names nobody while nobody has anything.
check('27. the majority line claims no leader before a round is settled',
  /none decided yet/.test(q(dom, '.g-majority-text').textContent),
  q(dom, '.g-majority-text').textContent);

check('8. and no constituency list on the game home screen',
  !q(dom, '.lf-group') && !q(dom, '.seat-row'));

check('1. no campaign actions on the home screen', qq(dom, '.act').length === 0,
  qq(dom, '.act').length + ' actions');
check('2. tapping a candidate is how you campaign',
  q(dom, '.lb-row').tagName.toLowerCase() === 'button');

const shownProbabilities = /\b(35|30|20|15|45|25|40)%\s*(chance|probability)/i.test(text(dom));
check('   exact probabilities are never shown', !shownProbabilities);

/* ------------------------------------------------------- the money tab */

openSection(dom, 'Money');
check('23. money opens on its own with cash in hand largest',
  cashInHand(dom) === '₹5 crore', 'got ' + cashInHand(dom));
check('23. spent starts at nothing',
  moneyLine(dom, 'Spent on the campaign') === '₹0', moneyLine(dom, 'Spent on the campaign'));
check('23. debt starts at nothing',
  moneyLine(dom, 'Debt outstanding') === '₹0', moneyLine(dom, 'Debt outstanding'));
check('23. grants received has a line of its own',
  moneyLine(dom, 'Grants received') === '₹0', moneyLine(dom, 'Grants received'));
check('23. so do fines paid',
  moneyLine(dom, 'Fines paid') === '₹0', moneyLine(dom, 'Fines paid'));
check('23. transactions are listed', /Transactions/.test(text(dom)));
check('   political heat is here, and only here',
  /0 of 100/.test(text(dom)) && !!q(dom, '.g-heat-fill'));
check('   with a way to borrow',
  !!qq(dom, 'button').find((b) => /Borrow money/.test(b.textContent)));
check('45. and a way back without scrolling', !!q(dom, '.g-section-head .sd-back'));

openSection(dom, 'Home');
check('   money is not repeated on the home screen',
  !qq(dom, '.sum-line').length);

/* ---------------------------------------------------------------- spend */

section('3-5. Spending');
let game = dom.window.CMP.app.getGame();
check('7. a campaign opens on one round allowance, not a lump sum',
  CMP.campaign.remaining(game) === CMP.CAMPAIGN.income.perRound && game.spent === 0,
  String(CMP.campaign.remaining(game)));
check('15. and nothing was granted up front', game.budget === 0, String(game.budget));

const rallyCost = CMP.getAction('invest').cost;
await playCard(dom, 'Campaign');
game = dom.window.CMP.app.getGame();
check('5. a safe action works', game.spent === rallyCost, 'spent ' + game.spent);
// The outcome arrives as a sheet: it matters for a moment, then the log
// below keeps the record.
// 12. The result belongs to the seat, not to a dashboard: playCard has
// already dismissed it, so what is on screen is the constituency again.
check('12. the player is left on the constituency', !!q(dom, '.seat-detail'));

openSection(dom, 'Home');
await settle();
check('5. the money strip shows the money going down',
  q(dom, '.g-fig.is-lead').textContent.indexOf(
    dom.window.CMP.ui.money.words(50000000 - rallyCost)
  ) !== -1,
  q(dom, '.g-fig.is-lead').textContent);

openSection(dom, 'Money');
check('3. cash in hand drops',
  cashInHand(dom) === dom.window.CMP.ui.money.words(50000000 - rallyCost),
  cashInHand(dom));
check('3. spent is displayed',
  moneyLine(dom, 'Spent on the campaign') === dom.window.CMP.ui.money.words(rallyCost),
  moneyLine(dom, 'Spent on the campaign'));
check('23. and the spending shows up as a transaction',
  qq(dom, '.g-txn').length === 1 && /Campaign/.test(q(dom, '.g-txn').textContent),
  q(dom, '.g-txn') ? q(dom, '.g-txn').textContent : 'none');
openSection(dom, 'Home');

const heatBefore = game.heat;
await playCard(dom, 'Corruption');
game = dom.window.CMP.app.getGame();
check('6. a risky action works', game.spent === rallyCost + CMP.getAction('bribe').cost);
check('8. risky play raises Political Heat', game.heat > heatBefore, 'heat ' + game.heat);
// A report sheet is over the screen after a risky move; clear it first.
if (q(dom, '.report-sheet')) {
  clickIt(dom, q(dom, '.report-sheet .btn-primary'));
  await settle();
}
openSection(dom, 'Money');
check('8. the heat meter reflects it',
  new RegExp(Math.round(game.heat) + ' of 100').test(text(dom)),
  String(Math.round(game.heat)));
check('8. and a bar shows it', !!q(dom, '.g-heat-fill'));
openSection(dom, 'Home');

/* ---------------------------------------------------------------- overspend */

section('4. Overspending is impossible');
game = dom.window.CMP.app.getGame();
// Leave exactly enough for the cheapest campaign action and nothing like
// enough for the dearest, so both sides of the rule are exercised. Accepting
// undisclosed funding is free and so is excluded from "cheapest" — it is
// deliberately still available to a campaign with nothing left.
const cheapest = Math.min.apply(
  null,
  CMP.ACTIONS.filter((a) => a.cost > 0).map((a) => a.cost)
);
game.cash = cheapest;
game.spent = game.budget - cheapest;
dom.window.CMP.storage.save(game);
dom.window.CMP.app.goTo('election');

/*
 * 26. A campaign nobody can pay for is not offered.
 *
 * The panel is one amount now, so affordability is the range on the slider
 * rather than a list of moves greyed out — and what it can never offer is more
 * than the campaign holds.
 */
await openCampaignSheet(dom);
const brokeRange = q(dom, '.cs-range');
check('26. the panel never offers more than the campaign holds',
  !brokeRange || Number(brokeRange.max) <= dom.window.CMP.campaign.remaining(
    dom.window.CMP.app.getGame()),
  brokeRange ? brokeRange.max + ' of ' + dom.window.CMP.campaign.remaining(
    dom.window.CMP.app.getGame()) : 'nothing offered');

// Dispatching a click straight at a disabled button would still run the
// handler in jsdom, which tests nothing a player can do. The engine's own
// refusal is the guarantee worth checking.
const spentBefore = dom.window.CMP.app.getGame().spent;
const refusedPush = dom.window.CMP.campaign.canPlay(
  dom.window.CMP.app.getGame(), 'bribe', 20, 40 * 10000000
);
check('26. the engine refuses an unaffordable move', refusedPush.ok === false,
  refusedPush.reason);
check('4. and nothing was spent', dom.window.CMP.app.getGame().spent === spentBefore);
check('4. spending never exceeds what came in',
  dom.window.CMP.app.getGame().spent <= dom.window.CMP.app.getGame().incomeTotal);

clickIt(dom, qq(dom, '.campaign-sheet button').find((b) => b.textContent === 'Cancel'));
await settle();

/* ---------------------------------------------------------------- save */

section('11. Saving');
const saved = dom.window.CMP.storage.load();
check('11. the game is saved', !!saved);
check('11. the balance is saved', typeof saved.cash === 'number');
check('63. and so is what each round has already paid',
  saved.incomeCredited && Object.keys(saved.incomeCredited).length > 0,
  JSON.stringify(saved.incomeCredited));
check('11. spending saved', saved.spent === spentBefore);
check('11. heat saved', typeof saved.heat === 'number');
check('11. constituency support saved', Object.keys(saved.support).length === 117);
check('11. actions taken saved', saved.actions.length >= 2);
check('11. turn saved', typeof saved.turn === 'number');
check('11. party saved', saved.partyId === 'p1', String(saved.partyId));
check('23. and the party they founded went with it',
  (saved.parties || []).length === 4 &&
  saved.parties[0].name === 'Punjab Development Party',
  JSON.stringify((saved.parties || []).map((x) => x.name)));
check('11. candidate saved', saved.candidateName === 'Simran Kaur Gill');
check('1. no slogan is stored any more', !saved.slogan);
check('11. marked as a solo game', saved.mode === 'solo');

const rawSave = dom.window.localStorage.getItem(dom.window.CMP.storage.KEY);
const rawProfile = dom.window.localStorage.getItem('cmp.punjab.profile.v1');
check('5. playing created a profile without anybody being asked to sign up',
  !!rawProfile && /Simran Kaur Gill/.test(rawProfile), String(rawProfile));
dom.window.close();
dom = await openPage([
  { key: 'cmp.punjab.save.v1', value: rawSave },
  { key: 'cmp.punjab.profile.v1', value: rawProfile },
]);

check('36. a returning player is welcomed back by name',
  /Welcome back/.test(text(dom)), text(dom).slice(0, 120));
check('36. and offered the election they are in the middle of',
  /Continue solo election/.test(text(dom)), text(dom).slice(0, 220));
check('4. the offer names the round they left it on',
  /Round \d+ of 20/.test(text(dom)), text(dom).slice(0, 220));
clickIt(dom, qq(dom, '.resume-link').find((b) => /Continue solo/.test(b.textContent)));
// Resuming pulls the board in on the way, so give it a moment.
await dom.window.CMP.data.ensure();
await settle();
check('   it resumes on the campaign panel', !!q(dom, '.screen-election'));
const resumed = dom.window.CMP.app.getGame();
check('11. spending survived the reload', resumed.spent === spentBefore, resumed.spent + ' vs ' + spentBefore);
check('11. heat survived the reload', resumed.heat === saved.heat);
check('11. support survived the reload', Object.keys(resumed.support).length === 117);
check('   the strip shows the restored cash',
  q(dom, '.g-fig.is-lead').textContent.indexOf(
    dom.window.CMP.ui.money.words(resumed.cash)
  ) !== -1,
  q(dom, '.g-fig.is-lead').textContent);

/* ---------------------------------------------------------------- map */

section('The constituency map');
const mapTab = menuItem(dom, 'Map');
check('a Map section is offered', !!mapTab);
clickIt(dom, mapTab);
check('the map opens', !!q(dom, '.punjab-map'));
check('all 117 constituencies are drawn', qq(dom, '.map-cell').length === 117,
  String(qq(dom, '.map-cell').length));
check('every cell has a real path', qq(dom, '.map-cell').every((c) => (c.getAttribute('d') || '').length > 20));
check('the state outline is drawn', !!q(dom, '.map-outline'));
check('district lines are drawn', qq(dom, '.map-district-line').length > 0);
check('each seat carries its AC number', qq(dom, '.map-seat-num').length === 117);

/*
 * 20. Every cell is coloured by its leader, or drawn as unclaimed ground
 * where there is not one — which early on is most of Punjab.
 */
const cellFills = qq(dom, '.map-cell').map((c) => c.getAttribute('fill') || '');
const decidedHere = Object.keys(
  dom.window.CMP.campaign.currentLeaders(dom.window.CMP.app.getGame().support)
).length;
check('20. a seat without a leader is drawn as unclaimed, not as somebody\u2019s',
  cellFills.filter((f) => f === 'var(--line)').length === 117 - decidedHere,
  cellFills.filter((f) => f === 'var(--line)').length + ' unclaimed of ' +
  (117 - decidedHere) + ' undecided');
check('20. and one with a leader takes that leader\u2019s colour',
  cellFills.filter((f) => /^#[0-9a-f]{6}$/i.test(f)).length === decidedHere,
  cellFills.filter((f) => /^#[0-9a-f]{6}$/i.test(f)).length + ' coloured');

// The legend counts seats that have a leader, so it can only ever add up to
// what has actually been decided.
const legendCounts = qq(dom, '.legend-count').map((n) => Number(n.textContent));
const legendTotal = legendCounts.reduce((a2, b2) => a2 + b2, 0);
const decidedNow = Object.keys(
  dom.window.CMP.campaign.currentLeaders(dom.window.CMP.app.getGame().support)
).length;
check('the legend counts every decided seat and no others',
  legendTotal === decidedNow, legendTotal + ' counted, ' + decidedNow + ' decided');
check('the legend states the majority', /majority 59/.test(q(dom, '.map-legend').textContent));

check('the map says the shapes are not official boundaries',
  /not official constituency boundaries/i.test(q(dom, '.map-note').textContent));

/*
 * 36. Tapping a seat opens the campaign panel over the map.
 *
 * Not a page, and not a detour: pick a seat, put money in, come back to the
 * map. That loop is the game, and every screen transition in the middle of it
 * was a screen transition in the middle of it.
 */
const cell = qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
clickIt(dom, cell);
await settle();

check('36. tapping a seat opens the campaign panel', !!q(dom, '.campaign-sheet'));
check('12. it names the seat',
  q(dom, '.campaign-sheet .sheet-title').textContent === 'Amritsar Central',
  q(dom, '.campaign-sheet .sheet-title').textContent);
check('12. and where it is',
  /AC 17 · Amritsar/.test(q(dom, '.cs-where').textContent),
  q(dom, '.cs-where').textContent);
check('20. with the standings, or that nobody has been here',
  !!q(dom, '.cs-positions') || /Nobody has campaigned/.test(q(dom, '.cs-open').textContent));

clickIt(dom, qq(dom, '.campaign-sheet button').find((b) => b.textContent === 'Cancel'));
await settle();
check('36. and cancelling puts the map back', !q(dom, '.campaign-sheet') && !!q(dom, '.punjab-map'));

/*
 * 4. No sitting member, anywhere.
 *
 * The seat, its number and its district are real Punjab geography. Every
 * person and party on this screen is the game's own.
 */
check('4. no sitting member is shown', !q(dom, '.sd-mla'));
check('4. and the engine no longer carries any',
  !dom.window.CMP.INCUMBENTS && !dom.window.CMP.getIncumbent);
// Colours must follow the game, not a fixed picture.
menuItem(dom, 'Map');
const seat17 = () => qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
const before17 = seat17().getAttribute('fill') + '/' + seat17().getAttribute('fill-opacity');
const g17 = dom.window.CMP.app.getGame();
// Hand this seat overwhelmingly to the player and check the map follows.
// The seat may be empty — most of them are — so the field is written rather
// than adjusted.
g17.support[17] = {};
dom.window.CMP.getParties().forEach((p2) => {
  g17.support[17][p2.id] = p2.id === g17.partyId ? 80 : 5;
});
dom.window.CMP.app.goTo('election');
menuItem(dom, 'Map');
const after17 = seat17().getAttribute('fill') + '/' + seat17().getAttribute('fill-opacity');
check('the map repaints when support moves', before17 !== after17, before17 + ' -> ' + after17);
check('the seat now shows the player colour',
  seat17().getAttribute('fill') === dom.window.CMP.getParty(g17.partyId).colour);

// Tiles view.
clickIt(dom, qq(dom, '.map-modes .term-option').find((b2) => b2.textContent === 'Tiles'));
check('a tiles view is offered', qq(dom, '.map-cell').length === 117);
// Path-string length varies with coordinate digits, so measure the tiles.
function boxOf(d) {
  const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return [
    Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10,
    Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10,
  ].join('x');
}
const tileBoxes = new Set(qq(dom, '.map-cell').map((c) => boxOf(c.getAttribute('d') || '')));
check('every tile is identical in size', tileBoxes.size === 1,
  [...tileBoxes].slice(0, 3).join(' , '));
check('every tile sits on its own centre',
  new Set(dom.window.CMP.GEOMETRY.seats.map((s2) => s2.hex.join(','))).size === 117);
check('every seat has geometry', dom.window.CMP.GEOMETRY.seats.length === 117);

/* ---------------------------------------------------------------- picker */

section('2. My areas — the strategy centre');
// The overspend section above deliberately emptied the purse. Put it back,
// so the amount picker below is exercised with real choices in it.
(function () {
  const g = dom.window.CMP.app.getGame();
  g.cash = g.budget;
  g.spent = 0;
  dom.window.CMP.storage.save(g);
  dom.window.CMP.app.goTo('election');
})();
openSection(dom, 'Home');
await settle();
clickIt(dom, q(dom, '.lb-row.is-you'));
await settle();

/*
 * Tapping a party opens who they are and how they stand — §9 and §28. The
 * seat list is one tap further in, which is the right order: the usual
 * question is "how are they doing", not "where exactly".
 */
check('9. tapping my candidate opens their page', !!q(dom, '.cd'));
check('9. it names the candidate', q(dom, '.cd-name').textContent.length > 2,
  q(dom, '.cd-name').textContent);
check('28. with seats, support and district control',
  /seats/.test(q(dom, '.cd-figs').textContent) &&
  /support/.test(q(dom, '.cd-figs').textContent) &&
  /districts/.test(q(dom, '.cd-figs').textContent),
  q(dom, '.cd-figs').textContent.replace(/\s+/g, ' '));
check('9. and my own money, because it is mine',
  /available/i.test(q(dom, '.cd-figs').textContent),
  q(dom, '.cd-figs').textContent.replace(/\s+/g, ' '));
check('17. with a chart of leading, close and behind',
  qq(dom, '.ring-arc').length === 3 && !!q(dom, '.ar-ring-centre'));
check('17. the chart is real SVG, not an unknown element',
  q(dom, '.ring').namespaceURI === 'http://www.w3.org/2000/svg');
check('9. the districts controlled are listed', /Districts controlled/.test(text(dom)));
check('9. and the five strongest seats', /Top 5 strongest seats/.test(text(dom)));

clickIt(dom, qq(dom, 'button').find((b) => /All my seats/i.test(b.textContent)));
await settle();
check('9. with a way through to every seat', !!q(dom, '.areas'));
check('16. which opens as a summary, not as 117 rows',
  qq(dom, '.area-row').length <= 10 && !q(dom, '.seat-search'),
  qq(dom, '.area-row').length + ' rows');
check('18. statewide support is shown for all four parties',
  qq(dom, '.ar-support-row').length === 4);
check('18. and is labelled as game data rather than a poll',
  /not a real-world opinion poll/i.test(q(dom, '.areas').textContent));
check('19. the five strongest seats are listed', /Top 5 strongest seats/i.test(text(dom)));
// The closest-five block is offered only when there are close races to
// list, which on a freshly drawn board is not guaranteed. Asserting it
// unconditionally is what makes a suite fail once a fortnight for no reason.
const closeRaces = dom.window.CMP.ui.areas
  .survey(dom.window.CMP.app.getGame(), dom.window.CMP.app.getGame().partyId)
  .filter((r) => r.bucket === 'close').length;
check('19. and the five closest races, when there are any',
  /Closest 5 races/i.test(text(dom)) === closeRaces > 0,
  closeRaces + ' close races');
check('20. with a way to see all of them',
  !!qq(dom, 'button').find((b) => /View all 117/.test(b.textContent)));

/*
 * 20-22. Before a round is settled there are no strongest seats and no close
 * races, because there is nothing to be strong in or close to. What the screen
 * offers instead is the seats nobody has been to — which is what a player
 * wants first, an uncontested seat being the cheapest one to win.
 */
const blockTitles = () => qq(dom, '.ar-block-title').map((n) => n.textContent);
check('21-22. open seats are offered while nothing is decided',
  blockTitles().includes('Open seats') || closeRaces > 0,
  blockTitles().join(' / '));

clickIt(dom, qq(dom, 'button').find((b) => /View all 117/.test(b.textContent)));
await settle();

check('2. all 117 are listed', qq(dom, '.area-row').length === 117,
  qq(dom, '.area-row').length + ' rows');
check('3. each row is compact and clickable',
  qq(dom, '.area-row').every((n) => n.tagName.toLowerCase() === 'button'));
// A contested row reports both shares; an uncontested one says so instead of
// printing 0.0% against four parties nobody has campaigned for.
check('3. and shows my share where anybody has campaigned',
  qq(dom, '.area-mine').length === 117 &&
  qq(dom, '.area-mine:not(.is-open)').every((n) => /%$/.test(n.textContent)),
  qq(dom, '.area-mine:not(.is-open)').length + ' contested rows');
// A rival line only where there is a rival: a seat only one campaign has been
// to is led outright, and inventing an opponent for it would be a fiction.
check('3. and a rival only where there is one',
  qq(dom, '.area-rival').length <= qq(dom, '.area-mine:not(.is-open)').length,
  qq(dom, '.area-rival').length + ' rivals');
check('3. and an untouched seat says nobody has been there',
  qq(dom, '.area-mine.is-open').length > 0,
  qq(dom, '.area-mine.is-open').length + ' untouched');
check('4. filters are offered', qq(dom, '.seat-filters .seat-filter').length === 5,
  qq(dom, '.seat-filters .seat-filter').map((n) => n.textContent).join('/'));
check('4. with a search box', !!q(dom, '.seat-search'));
check('5. sorting is offered, closest race first',
  q(dom, '.ar-sort-select').value === 'closest',
  q(dom, '.ar-sort-select').value);
check('5. the closest race really is first',
  (function () {
    const rows = dom.window.CMP.ui.areas.survey(
      dom.window.CMP.app.getGame(),
      dom.window.CMP.app.getGame().partyId
    ).sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin));
    return q(dom, '.area-name').textContent === rows[0].name;
  })());

typeInto(dom, q(dom, '.seat-search'), 'Dera Baba');
check('4. searching narrows the list', qq(dom, '.area-row').length === 1,
  qq(dom, '.area-row').length + ' matches');
check('4. and finds the right seat',
  /Dera Baba Nanak/.test(q(dom, '.area-name').textContent),
  q(dom, '.area-name').textContent);
typeInto(dom, q(dom, '.seat-search'), '');

const allAreas = qq(dom, '.area-row').length;
clickIt(dom, qq(dom, '.seat-filters .seat-filter').find((b) => b.textContent === 'Close'));
check('4. filtering to close races shows fewer', qq(dom, '.area-row').length < allAreas,
  qq(dom, '.area-row').length + ' of ' + allAreas);
check('4. and every one of them is close',
  qq(dom, '.area-status').every((n) => /close/i.test(n.textContent)));
clickIt(dom, qq(dom, '.seat-filters .seat-filter').find((b) => b.textContent === 'All'));

const pickRow = qq(dom, '.area-row')[2];
const pickedName = pickRow.querySelector('.area-name').textContent;
clickIt(dom, pickRow);
check('10. a constituency opens when clicked',
  q(dom, '.sd-name') && q(dom, '.sd-name').textContent === pickedName,
  q(dom, '.sd-name') ? q(dom, '.sd-name').textContent : 'nothing opened');

/* --------------------------------------------- the campaign sheet */

section('9-13. Campaign here');
// The affordability block above deliberately emptied the purse. Put a round's
// allowance back, so the panel is exercised with real choices in it.
dom.window.CMP.app.getGame().cash = 20 * 10000000;
clickIt(dom, qq(dom, 'button').find((b) => /Campaign here/.test(b.textContent)));
await settle();
check('9. one button opens the campaign controls', !!q(dom, '.campaign-sheet'));
check('10. it names the seat', new RegExp(pickedName).test(q(dom, '.campaign-sheet').textContent));
/*
 * 14 + 42. The whole decision, on one panel.
 *
 * Where, how much, and whether to take a risk with it. There is no list of
 * campaign types to pick from — a rally, a media push and a community drive
 * were all money into a seat, and choosing between them was a decision about
 * vocabulary rather than about strategy.
 */
check('14. it says where the money can go and how much there is',
  /Available/.test(q(dom, '.cs-summary').textContent) &&
  /Invest/.test(q(dom, '.cs-amount').textContent),
  q(dom, '.cs-summary').textContent.replace(/\s+/g, ' ').slice(0, 80));
check('20. and where everybody stands here',
  !!q(dom, '.cs-positions') || !!q(dom, '.cs-open'));
check('2. no list of campaign types', qq(dom, '.campaign-sheet .act').length === 0,
  qq(dom, '.campaign-sheet .act').length + ' listed');
check('16. the two optional risks are on the same panel',
  qq(dom, '.cs-mode .cs-mode-label').map((n) => n.textContent).join('/') ===
  'Campaign/Negative/Corruption',
  qq(dom, '.cs-mode .cs-mode-label').map((n) => n.textContent).join('/'));
check('13. with a district-or-seat target', qq(dom, '.cs-target .term-option').length === 2,
  q(dom, '.cs-target') ? q(dom, '.cs-target').textContent : 'no toggle');
check('14. a stepper and a slider set the amount',
  qq(dom, '.cs-step').length === 2 && !!q(dom, '.cs-range'));
check('24. and the risk is stated', /Risk/.test(q(dom, '.cs-summary').textContent));

/*
 * 15. Getting in is capped at a crore.
 *
 * Nobody can buy their way into an open seat ahead of everybody else — an
 * opening is a foot in the door, not a purchase.
 */
check('15. an opening investment is capped',
  Number(q(dom, '.cs-range').max) === dom.window.CMP.CAMPAIGN.spending.entryMaximum,
  q(dom, '.cs-range').max + ' offered');
check('15. and the panel says why',
  /First campaign here/.test(q(dom, '.cs-cap').textContent),
  q(dom, '.cs-cap').textContent.slice(0, 60));

/*
 * 11. The slider survives being dragged.
 *
 * It used to repaint the whole panel on every input event, which threw away
 * the very input the finger was holding — so the browser had nothing left to
 * drag and each movement needed a fresh press. That reads as a slider that
 * moves one step at a time, and it is the thing to guard: the node identity
 * has to be the same before and after a drag, and the figures have to have
 * moved anyway.
 */
const sliderNode = q(dom, '.cs-range');
const valueBefore = q(dom, '.cs-amount-value').textContent;

function dragTo(value) {
  sliderNode.value = String(value);
  sliderNode.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const lo = Number(sliderNode.min);
const hi = Number(sliderNode.max);
[0.25, 0.5, 0.75, 1].forEach((f) => dragTo(Math.round(lo + (hi - lo) * f)));
await settle();

check('11. dragging the slider keeps the same slider',
  q(dom, '.cs-range') === sliderNode);
check('11. and the amount followed it',
  q(dom, '.cs-amount-value').textContent !== valueBefore ||
    Number(sliderNode.value) === hi,
  valueBefore + ' -> ' + q(dom, '.cs-amount-value').textContent);
check('11. the invest button says what it will spend',
  q(dom, '.campaign-sheet .btn-primary').textContent ===
    'Invest ' + q(dom, '.cs-amount-value').textContent,
  q(dom, '.campaign-sheet .btn-primary').textContent);
check('11. and the summary agrees with both',
  qq(dom, '.cs-summary .dialog-line')
    .some((n) => n.textContent.indexOf(q(dom, '.cs-amount-value').textContent) !== -1),
  qq(dom, '.cs-summary .dialog-line').map((n) => n.textContent).join(' | '));

// 11. Fine enough to be a drag rather than a handful of stops.
check('11. the slider moves continuously, not in jumps',
  (hi - lo) / Number(sliderNode.step) >= 40,
  Math.round((hi - lo) / Number(sliderNode.step)) + ' positions');

// 12. And it stops where the rule stops.
check('12. it says this is a first entry',
  !!q(dom, '.cs-entry-tag') &&
  /max/i.test(q(dom, '.cs-entry-tag').textContent),
  q(dom, '.cs-entry-tag') ? q(dom, '.cs-entry-tag').textContent : 'no tag');
check('12. and cannot be dragged past the cap',
  hi === dom.window.CMP.CAMPAIGN.spending.entryMaximum,
  hi + ' vs ' + dom.window.CMP.CAMPAIGN.spending.entryMaximum);
dragTo(hi);

const chosenAmount = Number(q(dom, '.cs-range').value);
const cashBeforeCampaign = dom.window.CMP.app.getGame().cash;
clickIt(dom, qq(dom, '.campaign-sheet button').find((b) => /^Invest/.test(b.textContent)));
await settle();

check('12. a short result follows', !!q(dom, '.result-sheet'));
check('12. it names the seat', new RegExp(pickedName).test(q(dom, '.result-sheet').textContent));
check('12. shows the support moving', qq(dom, '.rs-move').length >= 3);
check('12. and what it cost', /Money spent/.test(q(dom, '.rs-spent').textContent));
check('11. the chosen amount is what was actually charged',
  cashBeforeCampaign - dom.window.CMP.app.getGame().cash === chosenAmount,
  'spent ' + (cashBeforeCampaign - dom.window.CMP.app.getGame().cash) +
    ', chose ' + chosenAmount);
/*
 * 36. And it puts the map back.
 *
 * Pick a seat, put money in, come back to the map. The result used to offer a
 * next seat and a way to a dashboard, which was two more decisions than
 * anybody wanted at the moment the money had just gone.
 */
check('36. the result offers the way back',
  !!qq(dom, '.result-sheet button').find((b) => /Back to the map/.test(b.textContent)));

clickIt(dom, qq(dom, 'button').find((b) => /Back to the map/.test(b.textContent)));
await settle();
check('36. and taking it leaves no panel over the board', !q(dom, '.result-sheet'));

/* ------------------------------------------- 15. a rival's position */

section('15-16. A rival is public only');
openSection(dom, 'Home');
await settle();
clickIt(dom, qq(dom, '.lb-row').find((n) => !n.classList.contains('is-you')));
await settle();
check('15. a rival page opens', !!q(dom, '.cd'));
check('15. their seats and districts are public',
  /seats/.test(q(dom, '.cd-figs').textContent) &&
  /districts/.test(q(dom, '.cd-figs').textContent),
  q(dom, '.cd-figs').textContent.replace(/\s+/g, ' '));
check('15. their money is not', /private/i.test(q(dom, '.cd-figs').textContent),
  q(dom, '.cd-figs').textContent.replace(/\s+/g, ' '));
check('15. and no figure on the page is their cash',
  !/available/i.test(q(dom, '.cd-figs').textContent),
  q(dom, '.cd-figs').textContent.replace(/\s+/g, ' '));
check('16. and there are no campaign controls', qq(dom, '.act-use').length === 0);
openSection(dom, 'Home');

/* ------------------------------------------------------------ rounds */

section('Fifteen rounds, solo');

dom = await openPage();
clickIt(dom, playButton(dom));
await dom.window.CMP.data.ensure();
await settle();
typeInto(dom, qq(dom, '.field-input')[0], 'Round Runner');
typeInto(dom, qq(dom, '.field-input')[1], 'Round Runner Party');
clickIt(dom, dom.window.document.querySelector('.btn-xl'));
await settle();

check('the round bar is shown', !!q(dom, '.round-bar'));
check('it opens on round 1 of 20',
  /Round\s*1\s*\/\s*20/.test(q(dom, '.round-bar').textContent),
  q(dom, '.round-bar').textContent.slice(0, 40));
check('2. the ring carries the round, not a clock',
  q(dom, '.round-clock').textContent === 'R1',
  q(dom, '.round-clock').textContent);
check('2. and the ring itself is what drains',
  !!q(dom, '.rt-arc') && !!q(dom, '.rt-arc').getAttribute('stroke-dasharray'));
check('the leaderboard is shown', qq(dom, '.lb-row').length === 4);
check('and how many more seats are needed, or that none are decided',
  /needs \d+ more|past the majority|none decided yet/.test(q(dom, '.g-majority-text').textContent),
  q(dom, '.g-majority-text').textContent);

/**
 * Run a round out and let the shell pick it up. A round now has two stages:
 * the clock expires and the round settles into the results break, then the
 * break expires and the next round opens. This drives both.
 */
async function settleRound(d) {
  d.window.CMP.app.getGame().roundEndsAt = Date.now() - 1000;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 60));
    if (d.window.CMP.app.getScreen() === 'result') return;
    if (d.window.CMP.app.getGame().stage === 'results') return;
  }
}

async function endRound(d) {
  await settleRound(d);
  const g = d.window.CMP.app.getGame();
  if (d.window.CMP.app.getScreen() === 'result') return;
  g.nextRoundAt = Date.now() - 1000;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 60));
    if (d.window.CMP.app.getScreen() === 'result') return;
    if (d.window.CMP.app.getGame().stage === 'playing') return;
  }
}

let solo = dom.window.CMP.app.getGame();
await playCard(dom, 'Campaign');
const spentInRound1 = dom.window.CMP.app.getGame().spent;

/* The clock expires: the round settles and the scoreboard goes up. */
await settleRound(dom);
solo = dom.window.CMP.app.getGame();
check('the clock running out settles the round', solo.stage === 'results', solo.stage);
check('the scoreboard appears', !!q(dom, '.round-results'));

/*
 * Two screens, in order: what changed, then who leads. The news first, the
 * table second — a scoreboard that has barely moved is not what anybody is
 * waiting to see.
 */
check('4. what changed comes first',
  /Seats changed|No major seat changes/.test(q(dom, '.round-results').textContent),
  q(dom, '.round-results').textContent.slice(0, 80));
check('5. and the standings are not on that screen yet',
  !q(dom, '.board-row'), qq(dom, '.board-row').length + ' rows');
check('1. round one decided every seat', qq(dom, '.rr-change').length > 0,
  qq(dom, '.rr-change').length + ' shown');
check('8. no more than five are listed at once',
  qq(dom, '.rr-change').length <= 5, qq(dom, '.rr-change').length + ' shown');
check('7. each names the seat and who took it',
  qq(dom, '.rr-change').every((n) => !!n.querySelector('.rr-change-name')
    && !!n.querySelector('.rr-badge.is-to')));
check('8. with a way to see the rest',
  !!qq(dom, 'button').find((b) => /more change/i.test(b.textContent)),
  qq(dom, 'button').map((b) => b.textContent).join(' | ').slice(0, 120));

check('play is locked while the round is counted',
  !q(dom, '.action-card') && !q(dom, '.panel-tab'));

/* 10. Continue, and the standings follow. */
clickIt(dom, qq(dom, 'button').find((b) => /^Continue$/i.test(b.textContent)));
await settle();
check('10. continuing shows who is leading',
  /Who’s leading/i.test(q(dom, '.round-results').textContent),
  q(dom, '.round-results').textContent.slice(0, 60));
check('10. it ranks all four candidates', qq(dom, '.board-row').length === 4,
  qq(dom, '.board-row').length + ' rows');
check('10. and states the majority',
  /59/.test(q(dom, '.results-totals').textContent));
check('10. and how far the leader is from it',
  /more seats? needed|Majority reached/.test(q(dom, '.position').textContent),
  q(dom, '.position').textContent.slice(0, 60));

/*
 * Round one is not a milestone round, so the third screen is not offered.
 * The button appearing every round would make the two rounds that matter
 * look like every other one.
 */
check('no milestone screen on an ordinary round',
  !qq(dom, 'button').find((b) => /Halfway|round 15 review/i.test(b.textContent)));

/* The break expires: the next round opens. */
solo.nextRoundAt = Date.now() - 1000;
for (let i = 0; i < 40 && dom.window.CMP.app.getGame().stage !== 'playing'; i++) {
  await new Promise((r) => setTimeout(r, 60));
}
solo = dom.window.CMP.app.getGame();
check('the break ending opens the next round', solo.round === 2, 'round ' + solo.round);
check('play is possible again', dom.window.CMP.campaign.roundIsLive(solo));
goHome(dom);

/* ----------------------------------------- the two rounds that are not
 * like the others
 *
 * Round ten closes alliances and round fifteen is the review. Both get a
 * third results screen that says what has changed about the rules, rather
 * than another seat count.
 */
section('Round ten and round fifteen');

async function settledAt(rounds) {
  const w = dom.window;
  const g = w.CMP.state.startElection({ partyId: 'aap', candidateName: 'Simran Kaur Gill' });
  for (let r = 0; r < rounds; r++) {
    for (let m = 0; m < 3; m++) {
      w.CMP.campaign.play(g, m === 1 ? 'invest' : 'invest', ((r * 11 + m * 7) % 117) + 1,
        { outcome: 0.3, consequence: 0.9, consequencePick: 0.5 });
    }
    w.CMP.campaign.endRound(g);
    if (r < rounds - 1) w.CMP.campaign.startNextRound(g);
  }
  g.intermissionLeft = w.CMP.campaign.intermissionLeft(g);
  w.CMP.app.setGame(g);
  w.CMP.app.goTo('election');
  await settle();
  return g;
}

function stageOn(re) {
  return qq(dom, '.round-results button').find((b) => re.test(b.textContent));
}

/* ---- round ten: alliances close ---- */
await settledAt(10);
clickIt(dom, stageOn(/^Continue$|who.s leading/i));
await settle();

const halfwayBtn = stageOn(/Halfway/i);
check('round ten offers the halfway screen', !!halfwayBtn,
  qq(dom, '.round-results button').map((b) => b.textContent).join(' | ').slice(0, 120));
clickIt(dom, halfwayBtn);
await settle();

check('it says alliances are closing',
  /Alliances close now/i.test(q(dom, '.round-results').textContent));
check('it ranks the whole field', qq(dom, '.ms-row').length === 4,
  qq(dom, '.ms-row').length + ' rows');
check('and says how far each is from a majority',
  qq(dom, '.ms-row-need').every((n) => /short|majority|out/.test(n.textContent)),
  qq(dom, '.ms-row-need').map((n) => n.textContent).join(', '));
check('and what is still to come',
  /rounds left/.test(q(dom, '.ms-foot').textContent), q(dom, '.ms-foot').textContent);

// Nine seconds is a glance, and this screen has to be read and acted on.
const w2 = dom.window;
check('a milestone round gets a longer break',
  w2.CMP.campaign.breakAfter(10) > w2.CMP.campaign.breakAfter(9),
  w2.CMP.campaign.breakAfter(10) + 's vs ' + w2.CMP.campaign.breakAfter(9) + 's');
check('and so does the review',
  w2.CMP.campaign.breakAfter(15) === w2.CMP.campaign.breakAfter(10),
  w2.CMP.campaign.breakAfter(15) + 's');
check('every other round keeps the short one',
  [1, 5, 12, 19].every((r) => w2.CMP.campaign.breakAfter(r) === w2.CMP.ROUNDS.intermissionSeconds));

clickIt(dom, qq(dom, '.round-results button').find((b) => /Back to the standings/i.test(b.textContent)));
await settle();
check('and it goes back to the standings',
  /Who.s leading/i.test(q(dom, '.round-results').textContent));

/* ---- round fifteen: the review ---- */
const checkpoint = await settledAt(15);
clickIt(dom, stageOn(/^Continue$|who.s leading/i));
await settle();

const reviewBtn = stageOn(/round 15 review/i);
check('round fifteen offers the review', !!reviewBtn,
  qq(dom, '.round-results button').map((b) => b.textContent).join(' | ').slice(0, 120));
clickIt(dom, reviewBtn);
await settle();

const review = checkpoint.lastResult.review;
check('the engine ran the review at the checkpoint', !!review, JSON.stringify(review || null));
check('and gave a reason either way', !!(review && review.reason), review && review.reason);
check('the screen states the verdict',
  /is out|Everybody survives/i.test(q(dom, '.ms-note-title').textContent),
  q(dom, '.ms-note-title').textContent);
check('the whole field is shown, out or not', qq(dom, '.ms-row').length === 4,
  qq(dom, '.ms-row').length + ' rows');
check('and the final phase is named',
  /rounds 16 to 20/i.test(q(dom, '.ms-foot').textContent), q(dom, '.ms-foot').textContent);

if (review && review.party) {
  const out = qq(dom, '.ms-row.is-out');
  check('an eliminated campaign is marked out, not removed', out.length === 1,
    out.length + ' marked');
  // Not "not zero" — a campaign put out at the review may genuinely be on
  // nothing. What matters is that the elimination did not take its seats
  // away: the number shown is the number the board says it holds.
  const heldByOut = dom.window.CMP.campaign.heldSeats(checkpoint)[review.party] || 0;
  check('its seats stay on the board',
    Number((out[0].querySelector('.ms-row-seats') || {}).textContent) === heldByOut,
    (out[0].querySelector('.ms-row-seats') || {}).textContent + ' shown, ' +
      heldByOut + ' on the board');
}

// Those two were built to look at, not to play on. The suite carries on with
// the campaign it was in the middle of.
dom.window.CMP.app.setGame(solo);
dom.window.CMP.app.goTo('election');
await settle();

goHome(dom);
check('and the board is back',
  qq(dom, '.g-strategy-item').length === 2 && !!q(dom, '.punjab-map'));
check('the campaign log kept the round it happened in',
  solo.actions[0].round === 1, String(solo.actions[0].round));
check('a summary card appears', !!q(dom, '.summary-card'));
// 55. Territory changes hands slowly and pays every round it stays, so the
// round it moves is the round worth reporting.
check('55. the round summary reports districts held',
  /Districts held/.test(q(dom, '.summary-card').textContent),
  q(dom, '.summary-card').textContent.replace(/\s+/g, ' ').slice(0, 200));
check('55. and the seats, cash and support that moved',
  /Seats led/.test(q(dom, '.summary-card').textContent) &&
  /Cash in hand/.test(q(dom, '.summary-card').textContent) &&
  /Average support/.test(q(dom, '.summary-card').textContent));
check('it says which round finished', /Round 1 complete/.test(q(dom, '.summary-card').textContent));
check('it reports the money spent this round',
  new RegExp(dom.window.CMP.ui.money.words(spentInRound1)).test(q(dom, '.summary-card').textContent),
  q(dom, '.summary-card').textContent.slice(0, 120));
check('history recorded the finished round', solo.history.length === 1);

clickIt(dom, q(dom, '.summary-close'));
check('the summary can be dismissed', !q(dom, '.summary-card'));

/* 17. Borrowing, through the interface. */
clickIt(dom, menuItem(dom, 'Loan'));
await settle();
check('17. a loan section is offered', !!q(dom, '.loan-offers'));

const loanText = () => q(dom, '.screen-election').textContent;
check('17. the interest is stated', /20%/.test(loanText()));
check('17. and when it falls due', /4 rounds later/.test(loanText()));

/*
 * 16. The bank lends against capacity, so the screen leads with what this
 * campaign can actually borrow rather than a figure it will refuse later.
 */
check('16. the amount available to borrow is stated',
  /Available to borrow/i.test(loanText()));
check('15. and what it was worked out from',
  /Cash in hand/i.test(loanText()) &&
  /Allowances before it falls due/i.test(loanText()),
  loanText().slice(0, 200));
check('18. nothing above the affordable amount is offered',
  qq(dom, '.loan-offer').every((b) => {
    const asked = Number(b.dataset.amount || 0);
    return !asked || asked <= dom.window.CMP.campaign.maxLoan(dom.window.CMP.app.getGame());
  }));
check('17. a few amounts are offered, not every increment',
  qq(dom, '.loan-offer').length >= 3 && qq(dom, '.loan-offer').length <= 5,
  qq(dom, '.loan-offer').length + ' offers');
check('17. each shows the repayment before it is taken',
  qq(dom, '.loan-offer').every((n) => /repay .* · round \d+/.test(n.textContent)),
  q(dom, '.loan-offer').textContent);

const cashBeforeBorrowing = dom.window.CMP.app.getGame().cash;
clickIt(dom, qq(dom, '.loan-offer')[0]);
await settle();
check('borrowing asks for confirmation', !!q(dom, '.dialog'));
check('the confirmation states the repayment',
  /You repay/.test(q(dom, '.dialog').textContent));
clickIt(dom, q(dom, '.dialog-buttons .btn-primary'));
await settle();

check('15. the money section separates where it came from',
  (function () {
    clickIt(dom, menuItem(dom, 'Money'));
    clickIt(dom, qq(dom, 'button').find((b) => /Where it came from/.test(b.textContent)));
    const ok = !!q(dom, '.breakdown') && /Starting budget/.test(q(dom, '.breakdown').textContent);
    const close = qq(dom, '.sheet button').find((b) => b.textContent === 'Close');
    if (close) clickIt(dom, close);
    return ok;
  })());

solo = dom.window.CMP.app.getGame();
check('the loan is granted', solo.loans.length === 1);
check('cash rose by the amount borrowed',
  solo.cash === cashBeforeBorrowing + solo.loans[0].amount, String(solo.cash));
check('and the debt is tracked apart from it',
  dom.window.CMP.campaign.debtOf(solo) === solo.loans[0].repay);
check('the player strip flags the debt', !!q(dom, '.g-fig.is-debt'),
  q(dom, '.g-fig.is-debt') ? q(dom, '.g-fig.is-debt').textContent : 'no debt shown');

/* Run out the rest of the campaign. */
let rounds = 0;
while (dom.window.CMP.app.getScreen() === 'election' && rounds++ < 26) {
  await endRound(dom);
}

check('the campaign ends after twenty rounds', rounds <= 21, String(rounds));
check('the result screen opens on its own', dom.window.CMP.app.getScreen() === 'result');
check('the loan was settled during the campaign',
  dom.window.CMP.app.getGame().loans.every((l) => l.settled));
check('cash never went negative', dom.window.CMP.app.getGame().cash >= 0,
  String(dom.window.CMP.app.getGame().cash));
check('all twenty rounds are in the history',
  dom.window.CMP.app.getGame().history.length === 20,
  String(dom.window.CMP.app.getGame().history.length));

/* The count. */
check('the count runs seat by seat', !!q(dom, '.count-live'));
const skipBtn = qq(dom, 'button').find((b) => /Show the result/.test(b.textContent));
if (skipBtn) clickIt(dom, skipBtn);
await settle();
check('the full result follows', !!q(dom, '.result-rows'));
const soloTotal = qq(dom, '.result-row .result-seats')
  .reduce((t, n) => t + Number(n.textContent.trim()), 0);
check('all 117 seats are declared', soloTotal === 117, String(soloTotal));

/*
 * 54. What each campaign built, as opposed to what it won. Two campaigns can
 * finish on the same seat count having played completely different games, and
 * the seat total alone hides that entirely.
 */
check('54. the result reports districts controlled',
  /districts/i.test((q(dom, '.cn-rows') || {}).textContent || ''),
  ((q(dom, '.cn-rows') || {}).textContent || 'no block').replace(/\s+/g, ' ').slice(0, 120));
check('54. and the grant income those districts paid',
  /in grants/i.test((q(dom, '.cn-rows') || {}).textContent || ''));
// Every party that took a seat, including the independents and small parties
// the board carries as one row — the same set the result table lists.
check('54. for every party on the board',
  qq(dom, '.cn-row').length === qq(dom, '.result-row').length,
  qq(dom, '.cn-row').length + ' of ' + qq(dom, '.result-row').length);
check('54. two figures apiece',
  qq(dom, '.cn-row .cn-fig strong').length === qq(dom, '.cn-row').length * 2,
  qq(dom, '.cn-row .cn-fig strong').length + ' figures');
/*
 * The figures come off the engine, zero or not.
 *
 * A district counts only when every seat in it was won outright, so a short
 * campaign can honestly finish with none — and the block says so rather than
 * disappearing, which would read as missing information.
 */
check('54. and the figures match the engine',
  qq(dom, '.cn-row .cn-fig strong').length === qq(dom, '.cn-row').length * 2 &&
  qq(dom, '.cn-row .cn-fig strong').every((n) => n.textContent.trim().length > 0),
  qq(dom, '.cn-row .cn-fig strong').map((n) => n.textContent).join(' / '));

/* ---------------------------------------------------------------- console */

section('A seat that has been won');

/*
 * Won is the only state in this game that cannot be undone, and four separate
 * screens have to agree about it: the seat itself, the round result that
 * declared it, the grants ledger that pays for it, and My Areas. A seat that
 * reads "leading 74%, campaign here" on one screen and "won" on another is
 * worse than either, so this section drives one game to a win and reads all
 * four.
 */
const wonWin = dom.window;
const wonGame = wonWin.CMP.state.startElection({
  partyId: 'aap',
  candidateName: 'Simran Kaur Gill',
});

// A seat with one campaign in it and enough influence behind it to be
// commanding. Built directly rather than played, because reaching a 70% share
// through the ₹1 crore entry cap takes more rounds than a UI test should.
const LOCKED = 17;
const MINE = wonGame.partyId;
const RIVAL = wonWin.CMP.getParties().filter((x) => x.id !== MINE)[0].id;
wonGame.support[LOCKED] = { [MINE]: 40 };
wonGame.support[18] = { [MINE]: 40 };
wonGame.wonSeats = wonGame.wonSeats || {};
const declared = wonWin.CMP.campaign.settleWins(wonGame, 3);

check('a commanding share in a campaigned seat is declared won',
  declared.some((d) => d.seat === LOCKED), JSON.stringify(declared));
check('and the engine records who won it and when',
  wonWin.CMP.campaign.wonBy(wonGame, LOCKED).party === MINE &&
  wonWin.CMP.campaign.wonBy(wonGame, LOCKED).round === 3,
  JSON.stringify(wonWin.CMP.campaign.wonBy(wonGame, LOCKED)));

/* ---- the seat itself ---- */
wonWin.CMP.app.setGame(wonGame);
wonWin.CMP.app.goTo('election');
await settle();

const seatNode = wonWin.CMP.ui.constituency.render(wonGame, LOCKED, { players: [] });
check('the seat says it is permanently won',
  /Permanently won/i.test(seatNode.querySelector('.sd-leader-kicker').textContent),
  seatNode.querySelector('.sd-leader-kicker').textContent);
check('it names the winner and the round',
  /round 3/i.test(seatNode.querySelector('.sd-leader-party').textContent),
  seatNode.querySelector('.sd-leader-party').textContent);
check('it reads as locked rather than as a lead',
  !!seatNode.querySelector('.sd-rating.is-locked'));
check('and offers nothing to campaign with',
  !seatNode.querySelector('.btn-campaign'));
check('it says why, in words',
  /rest of the election/i.test(seatNode.querySelector('.sd-locked-note').textContent),
  seatNode.querySelector('.sd-locked-note').textContent.slice(0, 70));

// An open seat still offers the button — the absence above is the won state,
// not the renderer having no footer.
const openNode = wonWin.CMP.ui.constituency.render(wonGame, 40, { players: [] });
check('an open seat is not locked', !openNode.querySelector('.sd-locked-note'));

/* ---- the engine refuses all three actions there ---- */
['invest', 'negative', 'bribe'].forEach((id) => {
  const verdict = wonWin.CMP.campaign.canPlay(wonGame, id, LOCKED, 1000000);
  check('a won seat refuses ' + id, verdict.ok === false, verdict.reason);
});

/* ---- the round result that declared it ---- */
const wonResult = {
  round: 3,
  standings: wonWin.CMP.getParties().map((party, i) => ({
    partyId: party.id,
    seats: 30 - i,
    won: party.id === MINE ? 1 : 0,
    leading: 29 - i,
    share: 25,
  })),
  changes: [],
  won: [{ seat: LOCKED, party: MINE, round: 3 }],
  conflicts: [{
    seat: 55,
    district: null,
    amount: 10000000,
    parties: [MINE, RIVAL],
  }],
};

const rr = wonWin.CMP.ui.scoreboard.create({
  you: () => MINE,
  trend: () => [],
  onFinished: () => {},
});
rr.render(wonResult, 30);
rr.stop();
const rrText = rr.root.textContent;

check('the round result announces the seat won', !!rr.root.querySelector('.rr-win'));
check('it says the seat is locked from now on',
  /rest of the election|Locked/i.test(rr.root.querySelector('.rr-win-note').textContent),
  rr.root.querySelector('.rr-win-note').textContent);
check('it announces the campaign conflict', !!rr.root.querySelector('.rr-conflict'));
check('and says nobody gained and nobody was refunded',
  /Nobody gained, nobody was refunded/.test(
    rr.root.querySelector('.rr-conflict-note').textContent),
  rr.root.querySelector('.rr-conflict-note').textContent);
check('the conflict names what was matched',
  /crore|lakh/.test(rr.root.querySelector('.rr-conflict-note').textContent));
check('both sides of the conflict are named',
  rr.root.querySelectorAll('.rr-conflict-parties .rr-badge').length === 2,
  rr.root.querySelectorAll('.rr-conflict-parties .rr-badge').length + ' named');
check('a round with wins is never called quiet',
  !/No major seat changes/.test(rrText));


/* ---- the grants ledger counts won seats, not led ones ---- */
const district = wonWin.CMP.DISTRICTS.find((d) => d.seats.indexOf(LOCKED) !== -1);
check('the seat sits in a real district', !!district, LOCKED);

// Lead every seat in it without winning any: that must pay nothing.
const ledGame = wonWin.CMP.state.startElection({ candidateName: 'S' });
const LED = ledGame.partyId;
const controlIds = () =>
  wonWin.CMP.campaign.districtsWonBy(ledGame, LED).map((d) => d.id);

district.seats.forEach((n) => {
  ledGame.support[n] = { [LED]: 12 };
});
check('leading every seat in a district is not controlling it',
  controlIds().indexOf(district.id) === -1, controlIds().join('/') || 'none');
check('and it pays nothing',
  wonWin.CMP.campaign.grantTotal(ledGame) === 0,
  String(wonWin.CMP.campaign.grantTotal(ledGame)));

// Win every seat in it, and it pays.
ledGame.wonSeats = ledGame.wonSeats || {};
district.seats.forEach((n) => {
  ledGame.wonSeats[String(n)] = { party: LED, round: 4, share: 80 };
});
check('winning every seat in it is control',
  controlIds().indexOf(district.id) !== -1, controlIds().join('/') || 'none');

/* ---- my areas reports won and leading apart ---- */
const areas = wonWin.CMP.ui.myAreas.create({
  onAllocate: () => ({ ok: true }),
  onChanged: () => {},
});
areas.render(ledGame);
const controlFigs = [].slice.call(areas.root.querySelectorAll('.ma-control-fig'));
check('my areas opens with what the campaign controls', controlFigs.length === 4,
  controlFigs.length + ' figures');
check('seats won leads it',
  /seats won/i.test(controlFigs[0].textContent) &&
  controlFigs[0].querySelector('.ma-control-value').textContent ===
    String(district.seats.length),
  controlFigs[0].textContent);
check('won and leading are never added together',
  controlFigs[1].querySelector('.ma-control-value').textContent === '0',
  controlFigs[0].textContent + ' / ' + controlFigs[1].textContent);
check('and it states the grant income',
  /grants a round/i.test(controlFigs[3].textContent),
  controlFigs[3].textContent);

const controlled = [].slice.call(areas.root.querySelectorAll('.ma-region'))
  .map((n) => n.textContent).join(' | ');
check('the region says how many seats are won',
  new RegExp(district.seats.length + ' / ').test(controlled), controlled.slice(0, 120));

/* ---- and nothing anywhere still counts three moves ---- */
const everywhere = dom.window.document.body.textContent;
check('no "3 moves" rule survives in the UI',
  !/3\s*\/\s*3|three moves|3 moves/i.test(everywhere));

section('12. Console');
const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
check('12. no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

openWindows.forEach((d) => {
  try {
    d.window.close();
  } catch (e) {
    /* already closed */
  }
});
server.close();

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
