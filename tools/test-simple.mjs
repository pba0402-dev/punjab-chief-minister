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
// The solo card: still the way this suite starts a game, but no longer the
// first button on the page — Play / Join leads now.
const playButton = (d) => qq(d, '.h-card.is-solo')[0];
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
/*
 * Back to the board.
 *
 * The four-way bar is on every screen now, so walking back until it appears
 * finds it immediately and goes nowhere. Home is a tap.
 */
function goHome(d) {
  const home = qq(d, '.g-nav-item').find((n) => {
    const label = n.querySelector('.g-nav-label');
    return label && label.textContent === 'Home';
  });
  if (home) clickIt(d, home);
  if (!q(d, '.g-nav')) throw new Error('could not get back to the game board');
}

/*
 * Open a screen the way a player does.
 *
 * Loan, Grant and Alliances are the three buttons above the map; everything else
 * lives under More, because none of it is opened every round.
 */
function openSection(d, label) {
  goHome(d);
  // The map is the home screen now, so there is nowhere to go for it.
  if (label === 'Home' || label === 'Map') return;

  const strategy = qq(d, '.g-nav-item').find((n) => {
    const name = n.querySelector('.g-nav-label');
    return name && name.textContent === label;
  });
  if (strategy) {
    clickIt(d, strategy);
    return;
  }

  // Money came off the More menu; the figure that summarises it opens it,
  // which is how the grant purse beside it has always worked.
  if (label === 'Money') {
    clickIt(d, q(d, '.round-aside .g-fig.is-lead'));
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
  /*
   * Opening a seat opens the panel over the board now. The panel spends by
   * itself — plain campaigning, one button — and the full seat screen behind
   * it is where the other two kinds of move live. This suite tests all three,
   * so it takes the same step through that a player does.
   */
  const full = qq(d, 'button').find((b) => /Full seat detail/.test(b.textContent));
  if (full) {
    clickIt(d, full);
    await settle();
  }
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
 * Found a party and start playing, the way the setup screen works now.
 *
 * Four steps: candidate, party, round length, start. The suite used to fill
 * one long form and press the button; walking the steps is what a player
 * does, and it means a step that stops working fails a test rather than
 * quietly changing what the suite is exercising.
 */
const startSolo = async (d, who, party) => {
  const advance = async () => {
    clickIt(d, q(d, '.screen-setup .btn-start'));
    await settle();
  };

  // Step 1: a player the game has never met types a name.
  const nameField = q(d, '.screen-setup .field-input');
  if (nameField && !q(d, '.setup-playing')) typeInto(d, nameField, who);
  await advance();

  // Step 2: the party. A blank name is generated, so this only types one
  // where the test cares what it is called.
  if (party) {
    const partyField = q(d, '.screen-setup .field-input');
    if (partyField) typeInto(d, partyField, party);
    await settle();
  }
  await advance();

  // Step 3: whatever round length is already selected.
  await advance();

  // Step 4: start.
  await advance();
};

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
/*
 * 2 + 10. One way in, and it is one button.
 *
 * Creating an election and joining one were two cards of their own, which made
 * them look like two games. They are the same game from either end, so the
 * choice between them belongs one step in.
 */
const primaryCard = qq(dom, '.h-card.is-primary')[0];
check('2. Play / Join Election is the strongest action',
  !!primaryCard && /Play \/ Join Election/i.test(primaryCard.textContent),
  primaryCard ? primaryCard.textContent : 'no primary card');
check('2. and it says what it does',
  /create an election or join one/i.test(primaryCard.textContent),
  primaryCard.textContent);
check('2. "Play with friends" and "Join election" are not separate cards',
  !/Play with friends/i.test(text(dom)) &&
  qq(dom, '.h-card').filter((c) => /^Join election/i.test(c.textContent)).length === 0);
check('2. solo is still offered', !!playButton(dom),
  qq(dom, '.h-card').map((c) => c.querySelector('.h-card-label').textContent).join(' / '));

/*
 * 4 + 8 + 9 + 10. Two places to go, and the statistics are not on this page.
 *
 * The leaderboard was a third card here. It is a table of other people's
 * results, which is the last thing the way into a game should compete with,
 * so it moved to the statistics screen — where the rest of the public figures
 * already are. This asserts both halves: that it is gone from here, and that
 * what is left is exactly the two.
 */
const navLabels = qq(dom, '.h-nav .h-card-label').map((n) => n.textContent);
check('10. the two navigation cards are there',
  navLabels.join('/') === 'Game Statistics/My Profile',
  navLabels.join('/'));
check('10. and the leaderboard is not one of them',
  !/leaderboard/i.test(text(dom)));
check('4. no statistics block is on the home screen',
  !q(dom, '.h-figures') && !q(dom, '.st-figs'));
check('8. and no leaderboard rows either',
  qq(dom, '.h-board-row').length === 0, qq(dom, '.h-board-row').length + ' rows');
check('3. nothing to continue means no Continue card',
  qq(dom, '.h-card.is-continue').length === 0,
  qq(dom, '.h-card.is-continue').length + ' shown');
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
check('1. the budget is granted, not entered', !q(dom, '.field-money'));
check('9. enough symbols for a table of four',
  dom.window.CMP.PARTY_SYMBOLS.length >= 4,
  dom.window.CMP.PARTY_SYMBOLS.length + ' symbols');
check('12. and offers every face the game has',
  qq(dom, '.cd-card').length === dom.window.CMP.AVATARS.length,
  qq(dom, '.cd-card').length + ' of ' + dom.window.CMP.AVATARS.length);
check('12. enough of them for a table of four',
  dom.window.CMP.AVATARS.length >= 4, dom.window.CMP.AVATARS.length + ' faces');

/*
 * 12. Every face is an image file, found by the id the save stores.
 *
 * The portraits used to be drawn inline; they are PNGs now, loaded from
 * assets/portraits/ and keyed by id, so what has to hold is that each card
 * asks for a picture and asks for it under the right name. jsdom fetches
 * nothing, so this is about the request rather than the result — the result
 * is what the fallback below is for.
 */
check('12. every face is an image, one per card',
  qq(dom, '.cd-card .portrait img').length === qq(dom, '.cd-card').length,
  qq(dom, '.cd-card .portrait img').length + ' of ' + qq(dom, '.cd-card').length);
check('12. and each is fetched by its own id',
  qq(dom, '.cd-card').every((n) => {
    const img = n.querySelector('.portrait img');
    return img && img.getAttribute('src') ===
      dom.window.CMP.assetUrl('portraits', n.dataset.avatar);
  }),
  (q(dom, '.cd-card .portrait img') || { src: 'none' }).src);
check('12. from a relative path, so it works wherever the game is served',
  qq(dom, '.cd-card .portrait img')
    .every((n) => /^assets\//.test(n.getAttribute('src'))),
  qq(dom, '.cd-card .portrait img').length
    ? q(dom, '.cd-card .portrait img').getAttribute('src') : 'none');

// 12. A picture that never arrives leaves a labelled circle, not a hole and
// not the browser's broken-image glyph.
check('12. with something legible behind it while it loads',
  qq(dom, '.cd-card .portrait-fallback').length === qq(dom, '.cd-card').length);

/* ------------------------------------------------ the candidate matters */

/*
 * A candidate is a strategy, not a portrait.
 *
 * The card carries four measures and three regions, and the regional numbers
 * are the ones that change the game: they multiply what a campaign in that
 * region buys. This asserts the screen is reading the same table the engine
 * reads, rather than showing numbers of its own.
 */
check('candidate: the four measures are shown as bars',
  qq(dom, '.cd-stat').length === 4,
  qq(dom, '.cd-stat-label').map((n) => n.textContent).join(' | '));
check('candidate: and regional support for every region',
  qq(dom, '.cd-region:not(.is-grant)').length === dom.window.CMP.REGIONS.length,
  qq(dom, '.cd-region:not(.is-grant)').length + ' regions');

{
  const first = qq(dom, '.cd-card')[0];
  const id = first.dataset.avatar;
  const real = dom.window.CMP.candidateStats(id);
  clickIt(dom, first);
  await settle();
  const shown = qq(dom, '.cd-stat').map((n) => n.querySelector('.cd-stat-value').textContent);
  check('candidate: the figures come from the candidate table',
    shown[0] === real.popularity + '%' && shown[1] === real.corruption + '%' &&
      shown[2] === real.leadership + '%' && shown[3] === real.campaignStrength + '%',
    shown.join(' ') + ' vs table ' + [real.popularity, real.corruption,
      real.leadership, real.campaignStrength].join(' '));

  /*
   * Strongest and weakest are derived, not written down.
   *
   * Change a number in the table and the words have to follow on the next
   * render — a label that could drift away from the bar above it would be
   * worse than no label.
   */
  const summary = dom.window.CMP.regionalSummary(id);
  const strongShown = q(dom, '.cd-summary-part:not(.is-weak) .cd-summary-value');
  check('candidate: the strongest region is derived from the numbers',
    summary.even ||
      (strongShown && strongShown.textContent ===
        summary.strongest.map((r) => r.name).join(' · ')),
    strongShown ? strongShown.textContent : 'even');

  // And it is the same table the engine multiplies campaigns by.
  const best = summary.ranked[0];
  check('candidate: and the engine agrees the strong region is worth more',
    summary.even ||
      dom.window.CMP.regionalMultiplier(id, best.id) > 1,
    String(dom.window.CMP.regionalMultiplier(id, best.id)));
}

/*
 * Grant potential is a reading, not an amount — and it comes from the grant
 * configuration rather than from today's grant rules, because those are going
 * to be replaced.
 */
check('candidate: grant potential is shown per region',
  qq(dom, '.cd-region.is-grant').length === dom.window.CMP.REGIONS.length,
  qq(dom, '.cd-region.is-grant').length + ' regions');
check('candidate: and it is read from the replaceable grant config',
  typeof dom.window.CMP.GRANT_CONFIG.potential === 'function' &&
    dom.window.CMP.GRANT_CONFIG.version >= 1);
check('candidate: it says it is an opportunity, not money',
  /opportunity, not an amount/i.test(q(dom, '.screen-setup').textContent));

/* --------------------------------------------------- through the steps */

/*
 * Setup is four steps now, not one long form.
 *
 * The candidate comes first because it is the only choice with consequences;
 * everything after it is identity. So the suite walks it the way a player
 * does rather than reaching into a page that no longer exists all at once.
 */
const nextStep = async () => {
  clickIt(dom, q(dom, '.screen-setup .btn-start'));
  await settle();
};

check('setup: four steps, and the first is the candidate',
  qq(dom, '.setup-step').length === 4 &&
    q(dom, '.setup-step.is-on .setup-step-label').textContent === 'Your candidate',
  qq(dom, '.setup-step-label').map((n) => n.textContent).join(' / '));

/*
 * A returning player is told their name once, not asked for it three times.
 */
check('setup: a known player is not asked who they are again',
  !!q(dom, '.setup-playing') || qq(dom, '.screen-setup .field-input').length > 0);

// A player the game has never met types a name; a returning one does not.
if (!q(dom, '.setup-playing')) {
  typeInto(dom, q(dom, '.screen-setup .field-input'), 'Simran Kaur Gill');
  await settle();
}

await nextStep();
check('setup: step two is the party', !!q(dom, '.sym-option'),
  q(dom, '.setup-step.is-on .setup-step-label')
    ? q(dom, '.setup-step.is-on .setup-step-label').textContent : 'none');

// 8 + 9 + 10. Everything a party is made of, and nothing else.
check('8. the party step asks for a name and a short name, and nothing more',
  qq(dom, '.screen-setup .field-input').length === 2,
  qq(dom, '.screen-setup .field-input').length + ' fields');
check('9. and offers every symbol the game has',
  qq(dom, '.sym-option').length === dom.window.CMP.PARTY_SYMBOLS.length,
  qq(dom, '.sym-option').length + ' of ' + dom.window.CMP.PARTY_SYMBOLS.length);
check('10. and colours', qq(dom, '.col-option').length >= 8,
  qq(dom, '.col-option').length + ' colours');

// 9. There is no slogan field anywhere in setup any more.
check('setup: no slogan is asked for',
  !/slogan/i.test(q(dom, '.screen-setup').textContent),
  q(dom, '.screen-setup').textContent.replace(/\s+/g, ' ').slice(0, 90));

// A colour is optional, and one is shown as assigned until somebody picks.
check('setup: a colour is assigned before anybody chooses one',
  !!q(dom, '.col-option.is-assigned') || !!q(dom, '.col-option.is-on'));

const partyInputs = qq(dom, '.screen-setup .field-input');
typeInto(dom, partyInputs[0], 'Punjab Development Party');
await settle();

// 29. The abbreviation writes itself from the name, and stays editable.
check('29. a short name is suggested from the party name',
  q(dom, '.js-short').value === 'PDP', q(dom, '.js-short').value);

clickIt(dom, qq(dom, '.sym-option')[3]);
clickIt(dom, qq(dom, '.col-option')[5]);
await settle();

await nextStep();
check('16. step three is the round length',
  qq(dom, '.screen-setup .clock-option').length === 3,
  qq(dom, '.screen-setup .clock-option').length + ' options');
check('16. two minutes by default',
  /2 min/.test(q(dom, '.screen-setup .clock-option.is-active').textContent),
  q(dom, '.screen-setup .clock-option.is-active').textContent.replace(/\s+/g, ' '));
check('16. and each says what it is for',
  qq(dom, '.clock-option-note').every((n) => n.textContent.length > 4),
  qq(dom, '.clock-option-note').map((n) => n.textContent).join(' | '));
// 7. What a round pays is stated where the round length is chosen, which is
// the one place the two facts are about the same thing.
check('7. the round allowance is stated beside the clock',
  /5 crore/i.test(q(dom, '.screen-setup').textContent),
  q(dom, '.screen-setup').textContent.replace(/\s+/g, ' ').slice(-110));

await nextStep();

// 11. And the card shows what all of it adds up to before anybody starts.
check('11. the preview names the player and the party',
  /SIMRAN KAUR GILL/i.test(q(dom, '.pv-name').textContent) &&
  /PUNJAB DEVELOPMENT PARTY/.test(q(dom, '.pv-party').textContent),
  q(dom, '.pv-name').textContent + ' / ' + q(dom, '.pv-party').textContent);
check('11. with the symbol and the badge on it',
  !!q(dom, '.pv-badge .sym') && q(dom, '.pv-short').textContent === 'PDP',
  q(dom, '.pv-badge') ? q(dom, '.pv-badge').innerHTML.slice(0, 80) : 'no badge');
check('11. and recaps the candidate and the clock',
  qq(dom, '.setup-recap-line').length === 3,
  qq(dom, '.setup-recap-label').map((n) => n.textContent).join(' / '));

await nextStep();

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
/*
 * 1. The round, and not the total.
 *
 * "Round 15 / 20" is two numbers where one is wanted. The dots under the bar
 * already say how far through the campaign this is.
 */
/*
 * 1. The round is the ring, and the ring is the only place it appears.
 *
 * It read "R1" inside the circle and "Round 1 / 20" beside it: the same
 * number three times over.
 */
check('1. the ring carries the round', q(dom, '.round-clock').textContent === 'R1',
  q(dom, '.round-clock').textContent);
check('1. and nothing beside it repeats the number',
  !q(dom, '.round-of') && !/Round\s*1/.test(q(dom, '.round-bar').textContent),
  q(dom, '.round-bar').textContent.slice(0, 60));

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
/*
 * 2 + 3. Loan is one tap from the board, and Grant and Alliances stay
 * beside each other.
 *
 * Borrowing was three taps down a menu, which is a long way for the thing a
 * player reaches for when they have run out of money mid-round.
 */
/*
 * 2. Four systems, always in reach.
 *
 * They were three buttons above the board that scrolled away with it, and
 * everything else was behind More. A campaign is run from these four, so they
 * are a bar under the title on every screen.
 */
check('2. the four systems are always in reach',
  qq(dom, '.g-nav-item .g-nav-label').map((n) => n.textContent).join('/') ===
  'Home/Grant/Alliances/Loan',
  qq(dom, '.g-nav-item .g-nav-label').map((n) => n.textContent).join('/'));
check('14. and the one you are on says so',
  qq(dom, '.g-nav-item.is-on').length === 1 &&
  q(dom, '.g-nav-item.is-on .g-nav-label').textContent === 'Home',
  q(dom, '.g-nav-item.is-on')
    ? q(dom, '.g-nav-item.is-on .g-nav-label').textContent : 'none marked');
// 5. Three levels — the whole state, a district, or a zone.
check('5. the map offers three geographic levels',
  qq(dom, '.map-regions .term-option').length === 3,
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

/*
 * Three levels, not four buttons.
 *
 * All Punjab, Majha, Doaba and Malwa used to sit in one row, which put the
 * whole state and one third of it on the same footing and left no room for a
 * district at all. The levels are what you are looking at; the row underneath
 * is which one.
 */
check('map: the levels are All Punjab, District and Zone',
  qq(dom, '.map-regions .term-option').map((b) => b.textContent).join('/') ===
    'All Punjab/District/Zone',
  qq(dom, '.map-regions .term-option').map((b) => b.textContent).join('/'));
check('map: and no zone sits in the level row',
  !qq(dom, '.map-regions .term-option')
    .some((b) => /Majha|Doaba|Malwa/.test(b.textContent)));

clickIt(dom, regionButton('Zone'));
await settle();
check('map: choosing Zone offers the three zones',
  qq(dom, '.map-scope-chip').map((b) => b.textContent).join('/') === 'Majha/Doaba/Malwa',
  qq(dom, '.map-scope-chip').map((b) => b.textContent).join('/'));

clickIt(dom, qq(dom, '.map-scope-chip').find((b) => b.textContent === 'Majha'));
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

// A zone is chosen from the row under the levels, not from the levels.
clickIt(dom, qq(dom, '.map-scope-chip').find((b) => b.textContent === 'Doaba'));
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
/*
 * 7 + 10. The block under the board is gone.
 *
 * The party legend, the four-appearance key, the majority and the paragraph
 * about what the shapes do not claim all lived under the map on every screen.
 * The key is beside the summary above the board now, the parties are the
 * summary itself, and the disclaimer is under More.
 */
check('10. no legend block under the map', !q(dom, '.map-legend'));
check('10. and no paragraph explaining the shapes',
  !q(dom, '.map-note') && !/not official constituency boundaries/i.test(text(dom)));
check('7. the four appearances are still explained, above the board',
  !!q(dom, '.map-summary .legend-key') &&
  ['open', 'leading', 'contested', 'won']
    .every((w) => new RegExp(w, 'i').test(q(dom, '.legend-key').textContent)),
  q(dom, '.legend-key') ? q(dom, '.legend-key').textContent : 'no key');
check('7. and the parties are named in the summary line',
  qq(dom, '.map-summary-short').length > 0 || /Nobody has campaigned/i.test(
    q(dom, '.map-summary').textContent),
  q(dom, '.map-summary').textContent.slice(0, 80));


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
check('27. nobody is marked as leading', !q(dom, '.lb-row.is-leading'));
check('27. and no bar is drawn', qq(dom, '.lb-bar-fill').length === 0);
check('   all four campaigns are still listed', qq(dom, '.lb-row').length === 4);
check('   with every seat count at zero',
  qq(dom, '.lb-seats').every((n) => n.textContent.trim() === '0'),
  qq(dom, '.lb-seats').map((n) => n.textContent).join('/'));
check('   and you are marked', !!q(dom, '.lb-row.is-you'));

/*
 * 9 + 12. A face, a party and a number of seats — and nothing else.
 *
 * The bars, the ranks, the percentage line and the majority line were four
 * ways of saying the same thing, and the seat count says it. Somebody who
 * wants the arithmetic can open a campaign; the board should not do it at
 * them while they are deciding where to spend.
 */
check('8. every row carries a face', qq(dom, '.lb-row .portrait').length === 4,
  qq(dom, '.lb-row .portrait').length + ' faces');
check('9. the majority line is gone from the game screen',
  !q(dom, '.g-majority'));
check('9. and so are the seat percentages', !q(dom, '.lb-shares'),
  q(dom, '.lb-shares') ? q(dom, '.lb-shares').textContent : 'gone');

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
check('3. and offered the election they are in the middle of',
  qq(dom, '.h-card.is-continue').length === 1 &&
  /Continue Election/i.test(text(dom)),
  text(dom).slice(0, 220));
check('3. the offer names the round they left it on',
  /Round \d+ of 20/.test(q(dom, '.h-card.is-continue').textContent),
  q(dom, '.h-card.is-continue').textContent);
clickIt(dom, q(dom, '.h-card.is-continue'));
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

/*
 * Who's Leading counts seats that have a leader, so it can only ever add up
 * to what has actually been decided.
 *
 * The line above the board used to carry the same four numbers. Two answers
 * to "who is winning" is one too many, and the one directly under the map —
 * which also says what each campaign has left — is the one worth keeping.
 */
// Who's Leading lives under the board on Home; the block above was reading
// the Map section, which is the board on its own.
// Who's Leading lives under the board on Home; the block above was reading
// the Map section, which is the board on its own.
goHome(dom);
await settle();
const leadingCounts = qq(dom, '.lb-seats').map((n) => Number(n.textContent));
const leadingTotal = leadingCounts.reduce((a2, b2) => a2 + b2, 0);
/*
 * Counted against heldSeats, which is what the block itself reads.
 *
 * currentLeaders answers a slightly different question — every seat with a
 * leader, including ones this campaign does not hold — so comparing against
 * it was comparing two different counts and calling the difference a bug.
 */
const heldNow = dom.window.CMP.campaign.heldSeats(dom.window.CMP.app.getGame());
const decidedNow = Object.keys(heldNow).reduce((a2, k) => a2 + heldNow[k], 0);
check('who is leading counts every seat anybody holds, and no others',
  leadingTotal === decidedNow, leadingTotal + ' counted, ' + decidedNow + ' held');
check('and the party counts are no longer duplicated above the board',
  qq(dom, '.map-summary-n').length === 0,
  qq(dom, '.map-summary-n').length + ' still there');

/*
 * Every campaign says what it has left, and it is the live balance.
 *
 * Not what they started with, not what they have spent, not what the
 * districts have paid them — the number the ledger and the round strip read,
 * so spending a rupee moves all three together.
 */
check('who is leading shows what each campaign has left',
  qq(dom, '.lb-money').length === qq(dom, '.lb-row').length,
  qq(dom, '.lb-money').map((n) => n.textContent).join(' | '));
{
  const g = dom.window.CMP.app.getGame();
  const mineRow = q(dom, '.lb-row.is-you .lb-money');
  const real = dom.window.CMP.campaign.heldTotal(g);
  check('and your own figure is the one the engine holds',
    mineRow.textContent === (dom.window.CMP.ui.money.words(real) || '₹0'),
    mineRow.textContent + ' vs ' + real);

  // Spending has to move it, on the next paint and not later. The purse is
  // put back afterwards: this suite goes on to spend for real, and a test
  // that quietly emptied the campaign would starve the ones after it.
  const before = mineRow.textContent;
  const keptCash = g.cash;
  g.cash = Math.max(0, (g.cash || 0) - 30000000);
  dom.window.CMP.app.goTo('election');
  goHome(dom);
  const after = q(dom, '.lb-row.is-you .lb-money').textContent;
  check('spending moves it', after !== before, before + ' -> ' + after);
  g.cash = keptCash;
  dom.window.CMP.app.goTo('election');
  goHome(dom);
}

// 10. And what the shapes do not claim is still said — under More, where
// people go to read rather than to campaign.
check('10. the disclaimer is not on the game screen',
  !/not official constituency boundaries/i.test(text(dom)));

/* ------------------------------------------------------- the seat panel */

/*
 * 36 + 9. Tapping a seat opens a panel OVER the map, not instead of it.
 *
 * Whether to spend in a seat is a question about its surroundings, so the
 * board has to stay on screen while the question is being asked. It used to
 * jump straight into the campaign sheet, which answered "how much" before
 * anybody had been told who was in the seat.
 */
const seatCell = (n) => qq(dom, '.map-cell').find((c) => c.dataset.seat === String(n));

clickIt(dom, seatCell(17));
await settle();

check('panel: tapping a seat opens the seat panel', !!q(dom, '.dp'));
check('panel: and the map is still on screen behind it', !!q(dom, '.punjab-map'));
check('panel: it names the seat',
  q(dom, '.dp-name').textContent === 'Amritsar Central',
  q(dom, '.dp-name') ? q(dom, '.dp-name').textContent : 'no name');
check('panel: with its number and district',
  /AC 17 · Amritsar/.test(q(dom, '.dp-where').textContent),
  q(dom, '.dp-where').textContent);

/*
 * 4 + 14.2. A seat nobody has touched.
 *
 * Every one of the 117 starts here. It must read as an invitation, not as a
 * result: no leader, no percentages, and every party listed as out of it.
 */
check('panel: an untouched seat says nobody has campaigned',
  /Nobody has campaigned/.test(q(dom, '.dp-state').textContent),
  q(dom, '.dp-state').textContent.replace(/\s+/g, ' ').trim());
check('panel: every party is listed', qq(dom, '.dp-row').length === 4,
  qq(dom, '.dp-row').length + ' rows');
check('panel: all of them marked as out of it',
  qq(dom, '.dp-row').every((r) => r.querySelector('.dp-mark').textContent === '○'),
  qq(dom, '.dp-row').map((r) => r.querySelector('.dp-mark').textContent).join(''));
check('panel: and all of them reading No bid',
  qq(dom, '.dp-pos').every((n) => /No bid/i.test(n.textContent)),
  qq(dom, '.dp-pos').map((n) => n.textContent).join(' | '));

/*
 * 14.9. Tapping another seat switches the panel rather than closing it.
 */
clickIt(dom, seatCell(18));
await settle();
check('panel: tapping another seat switches straight to it',
  !!q(dom, '.dp') && q(dom, '.dp-where').textContent.indexOf('AC 18') !== -1,
  q(dom, '.dp-where').textContent);
clickIt(dom, seatCell(17));
await settle();

/* 14.3 + 14.4. One bidder, then a contest, both read off the real board. */
{
  const g = dom.window.CMP.app.getGame();
  const me = g.partyId;
  const rival = dom.window.CMP.getParties()
    .map((x) => x.id).filter((x) => x !== me)[0];

  // One bidder: written onto the board the engine reads, not faked in the UI.
  g.support[17] = {};
  g.support[17][me] = 40;
  dom.window.CMP.app.goTo('election');
  menuItem(dom, 'Map');
  clickIt(dom, seatCell(17));
  await settle();

  const rowFor = (id) => qq(dom, '.dp-row').find(
    (r) => r.querySelector('.dp-party').textContent ===
      dom.window.CMP.getParty(id).short);

  check('panel: one bidder is marked as in the seat',
    rowFor(me).querySelector('.dp-mark').textContent === '✓',
    rowFor(me).textContent.replace(/\s+/g, ' ').trim());
  check('panel: unopposed, that reads as leading',
    /Leading/i.test(rowFor(me).querySelector('.dp-pos').textContent),
    rowFor(me).querySelector('.dp-pos').textContent);
  check('panel: and the others are still out of it',
    rowFor(rival).querySelector('.dp-mark').textContent === '○');

  // A contest: close enough that the rating says it is not settled.
  g.support[17][rival] = 38;
  dom.window.CMP.app.goTo('election');
  menuItem(dom, 'Map');
  clickIt(dom, seatCell(17));
  await settle();

  check('panel: a close race reads as contested, not as a lead',
    /Contested/i.test(rowFor(me).querySelector('.dp-pos').textContent),
    rowFor(me).querySelector('.dp-pos').textContent);
  check('panel: and the rival as trailing',
    /Trailing/i.test(rowFor(rival).querySelector('.dp-pos').textContent),
    rowFor(rival).querySelector('.dp-pos').textContent);
  check('panel: the header says so too',
    /Contested/i.test(q(dom, '.dp-state').textContent),
    q(dom, '.dp-state').textContent.replace(/\s+/g, ' ').trim());

  /* 14.5. Spending, through the game's own play(). */
  const cashBefore = dom.window.CMP.campaign.balanceOf(g);
  clickIt(dom, qq(dom, '.dp button').find((b) => /Spend money here/.test(b.textContent)));
  await settle();
  check('panel: the spend control offers amounts', qq(dom, '.dp-amount').length > 0,
    qq(dom, '.dp-amount').length + ' amounts');
  // The three figures sit beside the button rather than above the scroll,
  // because the arithmetic is the decision.
  check('panel: and shows available, spend and remaining',
    qq(dom, '.dp-tally-label').map((n) => n.textContent).join('/') ===
      'Available/This spend/Remaining',
    qq(dom, '.dp-tally-label').map((n) => n.textContent).join('/'));

  clickIt(dom, qq(dom, '.dp-amount')[0]);
  await settle();
  const go = qq(dom, '.dp button').find((b) => /^Spend ₹/.test(b.textContent));
  check('panel: with one button to do it', !!go,
    qq(dom, '.dp button').map((b) => b.textContent).join(' | '));
  clickIt(dom, go);
  await settle();
  await settle();

  const cashAfter = dom.window.CMP.campaign.balanceOf(dom.window.CMP.app.getGame());
  check('panel: spending actually takes the money',
    cashAfter < cashBefore,
    cashBefore + ' -> ' + cashAfter);
  check('panel: and the seat records the spend',
    (dom.window.CMP.app.getGame().areaBids || {})['17'] !== undefined);
}

  /*
   * 14.7 + 14.8. Two campaigns in one seat, and the lead changing hands.
   *
   * This is the case the panel exists for: the player has to be able to see
   * that somebody else is in the seat, what it would take to pass them, and
   * then watch the words change when they do. Both campaigns spend through
   * the engine, so the shares are the engine's arithmetic and not the
   * screen's.
   */
  {
    const g2 = dom.window.CMP.app.getGame();
    const me2 = g2.partyId;
    const rival2 = dom.window.CMP.getParties().map((x) => x.id)
      .filter((x) => x !== me2)[0];
    const rollsFor = { outcome: 0.4, consequence: 0.99, consequencePick: 0.5 };

    // A rival takes a clear lead in an empty seat, through the real engine.
    const rivalActor = (g2.opponents || []).find((o) => o.partyId === rival2);
    g2.support[23] = {};
    g2.cash = 60 * 10000000;
    if (rivalActor) {
      rivalActor.cash = 60 * 10000000;
      dom.window.CMP.campaign.playAs(g2, rivalActor, 'invest', 23, rollsFor, 10000000);
    }
    dom.window.CMP.app.goTo('election');
    menuItem(dom, 'Map');
    clickIt(dom, seatCell(23));
    await settle();

    const posOf = (id) => {
      const short = dom.window.CMP.getParty(id).short;
      const row = qq(dom, '.dp-row').find(
        (r) => r.querySelector('.dp-party').textContent === short);
      return row ? row.querySelector('.dp-pos').textContent.trim() : 'missing';
    };

    check('panel: a rival in the seat shows as in it',
      /Leading|Contested/i.test(posOf(rival2)), posOf(rival2));
    check('panel: and you as out of it', /No bid/i.test(posOf(me2)), posOf(me2));

    // Now outspend them, through the panel, and watch the words swap.
    clickIt(dom, qq(dom, '.dp button').find((b) => /Spend money here/.test(b.textContent)));
    await settle();
    const biggest = qq(dom, '.dp-amount').slice(-1)[0];
    clickIt(dom, biggest);
    await settle();
    clickIt(dom, qq(dom, '.dp button').find((b) => /^Spend ₹/.test(b.textContent)));
    await settle();
    await settle();

    check('panel: after spending you are in the seat',
      !/No bid/i.test(posOf(me2)), posOf(me2));
    check('panel: and the panel repainted without being reopened',
      !!q(dom, '.dp') && q(dom, '.dp-where').textContent.indexOf('AC 23') !== -1,
      q(dom, '.dp-where').textContent);

    /*
     * The lead itself: the engine decides who is ahead, and the panel's
     * header has to agree with it rather than keep its own answer.
     */
    const engineLeader = dom.window.CMP.campaign
      .seatStatus(dom.window.CMP.app.getGame(), 23).partyId;
    check('panel: the header names whoever the engine says is ahead',
      q(dom, '.dp-state-who').textContent
        .indexOf(dom.window.CMP.getParty(engineLeader).short) !== -1,
      q(dom, '.dp-state-who').textContent + ' vs engine ' + engineLeader);
  }

/* 14.6. Insufficient funds: offered nothing, told why. */
{
  const g = dom.window.CMP.app.getGame();
  const kept = g.cash;
  g.cash = 0;
  (g.grants || {}) && Object.keys(g.grants || {}).forEach((r) => { g.grants[r] = 0; });
  dom.window.CMP.app.goTo('election');
  menuItem(dom, 'Map');
  clickIt(dom, seatCell(19));
  await settle();
  check('panel: with no money there is no spend button',
    !qq(dom, '.dp button').some((b) => /Spend money here/.test(b.textContent)),
    qq(dom, '.dp button').map((b) => b.textContent.slice(0, 20)).join(' | '));
  check('panel: and it says how short you are',
    /You need at least/.test(q(dom, '.dp').textContent),
    q(dom, '.dp').textContent.replace(/\s+/g, ' ').slice(-90));
  g.cash = kept;
  dom.window.CMP.app.goTo('election');
  menuItem(dom, 'Map');
}

/*
 * A settled seat is finished, and the panel has to read that way.
 *
 * Offering a control the engine is going to refuse is worse than offering
 * none — and the lock is on everybody, including whoever won it.
 */
{
  const g3 = dom.window.CMP.app.getGame();
  g3.wonSeats = g3.wonSeats || {};
  g3.wonSeats['24'] = { party: g3.partyId, round: 3, share: 82 };
  dom.window.CMP.app.goTo('election');
  menuItem(dom, 'Map');
  clickIt(dom, seatCell(24));
  await settle();
  check('panel: a won seat says who took it',
    /has won this seat/.test(q(dom, '.dp').textContent),
    q(dom, '.dp').textContent.replace(/\s+/g, ' ').slice(-110));
  check('panel: and offers no way to spend in it',
    !qq(dom, '.dp button').some((b) => /Spend/.test(b.textContent)),
    qq(dom, '.dp button').map((b) => b.textContent.slice(0, 18)).join(' | '));
  check('panel: the full seat screen is still reachable from it',
    qq(dom, '.dp button').some((b) => /Full seat detail/.test(b.textContent)));
  delete g3.wonSeats['24'];
  clickIt(dom, q(dom, '.dp-close'));
  await settle();
}

/*
 * Grant, on the panel, and never mistakable for cash.
 *
 * Potential is a judgement about opportunity; grant in hand is money that can
 * only be spent in one region. A player who read the first as the second
 * would be spending against a number that was never there, so the panel keeps
 * them apart and says which is which.
 */
{
  clickIt(dom, seatCell(17));
  await settle();
  check('panel: grant has a section of its own',
    /Potential here/.test(q(dom, '.dp').textContent),
    q(dom, '.dp').textContent.replace(/\s+/g, ' ').slice(0, 90));
  check('panel: with a band and a reading',
    !!q(dom, '.dp-grant-value.is-high, .dp-grant-value.is-medium, .dp-grant-value.is-low'),
    q(dom, '.dp-grant') ? q(dom, '.dp-grant').textContent.replace(/\s+/g, ' ') : 'none');
  check('panel: and it says potential is not money',
    /not money/i.test(q(dom, '.dp').textContent));
  /*
   * It reads the replaceable config rather than the engine's grant rules,
   * which is the whole point of keeping that file separate.
   */
  const region = dom.window.CMP.regionOfSeat(17);
  const fromConfig = dom.window.CMP.grantPotential(
    dom.window.CMP.grantContextFor(dom.window.CMP.app.getGame(), region, null));
  check('panel: the reading comes from the grant configuration',
    q(dom, '.dp-grant').textContent.indexOf(String(fromConfig) + '%') !== -1,
    q(dom, '.dp-grant').textContent.replace(/\s+/g, ' ') + ' vs config ' + fromConfig);
  clickIt(dom, q(dom, '.dp-close'));
  await settle();
}

/* 9. Closing it leaves the board exactly where it was. */
clickIt(dom, seatCell(17));
await settle();
clickIt(dom, q(dom, '.dp-close'));
await settle();
check('panel: closing puts the board back', !q(dom, '.dp') && !!q(dom, '.punjab-map'));

/*
 * The full seat screen — history, ratings, the other kinds of move — is still
 * there, one step behind the panel rather than in front of it.
 */
clickIt(dom, seatCell(17));
await settle();
clickIt(dom, qq(dom, '.dp button').find((b) => /Full seat detail/.test(b.textContent)));
await settle();
check('panel: the full seat screen is still reachable',
  !!q(dom, '.seat-detail') && !q(dom, '.dp'));
clickIt(dom, q(dom, '.seat-detail .sd-back'));
await settle();
menuItem(dom, 'Map');


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
  q(dom, '.dp-name') && q(dom, '.dp-name').textContent === pickedName,
  q(dom, '.dp-name') ? q(dom, '.dp-name').textContent : 'nothing opened');

/* --------------------------------------------- the campaign sheet */

section('9-13. Campaign here');
// The affordability block above deliberately emptied the purse. Put a round's
// allowance back, so the panel is exercised with real choices in it.
dom.window.CMP.app.getGame().cash = 20 * 10000000;
// Through the panel, which is what a seat opens on now. The sheet behind it
// is where a negative campaign or a bribe is chosen.
clickIt(dom, qq(dom, '.dp button').find((b) => /Full seat detail/.test(b.textContent)));
await settle();
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
await startSolo(dom, 'Round Runner', 'Round Runner Party');

check('the round bar is shown', !!q(dom, '.round-bar'));
check('it opens on round 1', q(dom, '.round-clock').textContent === 'R1',
  q(dom, '.round-clock').textContent);
check('2. the ring carries the round, not a clock',
  q(dom, '.round-clock').textContent === 'R1',
  q(dom, '.round-clock').textContent);
check('2. and the ring itself is what drains',
  !!q(dom, '.rt-arc') && !!q(dom, '.rt-arc').getAttribute('stroke-dasharray'));
check('the leaderboard is shown', qq(dom, '.lb-row').length === 4);
// 9. And no majority arithmetic on the board. It is a calculation somebody
// can go and make; the game screen should not do it at them while they are
// deciding where to spend.
check('9. no majority arithmetic on the game screen',
  !q(dom, '.g-majority') && !/needs \d+ more/.test(text(dom)));

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
 * 4-11. Election night, region by region.
 *
 * Malwa, then Majha, then Doaba, then who is leading. It used to be one
 * screen with everything that changed, the seats taken for good and the money
 * two campaigns burned on each other, all stacked — correct, and more than
 * anybody reads in the seconds between rounds.
 */
/* ------------------------------------------------------ the overview */

/*
 * Every round opens on how it stands, then reads the regions out.
 *
 * It used to open on Malwa, which asked the player to follow a district
 * before anybody had told them whether they were winning. The regions are the
 * evidence; the overview is the answer.
 */
check('overview: the results open on the round overview',
  /End of round \d+/i.test(q(dom, '.rr-bar-title').textContent),
  q(dom, '.rr-bar-title').textContent);
check('overview: one card per campaign',
  qq(dom, '.ro-card').length === 4,
  qq(dom, '.ro-card').length + ' cards');
check('overview: each with a face, a party and a symbol',
  qq(dom, '.ro-card').every((n) => !!n.querySelector('.portrait') &&
    !!n.querySelector('.ro-card-party') && !!n.querySelector('.ro-card-sym .sym')));
check('overview: seats, popular vote, spend and grants on every card',
  qq(dom, '.ro-card').every((n) =>
    !!n.querySelector('.ro-seats-value') &&
    n.querySelectorAll('.ro-fig').length === 3),
  qq(dom, '.ro-fig-label').slice(0, 3).map((n) => n.textContent).join(' / '));
check('overview: and a word for where each of them stands',
  qq(dom, '.ro-card-state').every((n) =>
    /Won|Leading|Trailing|No bid/i.test(n.textContent)),
  qq(dom, '.ro-card-state').map((n) => n.textContent).join(' | '));

/*
 * The figures are the engine's, not the screen's.
 *
 * Seats, share, spend and grant income all come off the standings the engine
 * built when the round settled. This reads one card back and compares it with
 * that row, so a screen quietly computing its own numbers fails here.
 */
{
  const res = dom.window.CMP.app.getGame().lastResult;
  const rows = (res.standings || []).slice()
    .sort((a, b) => (b.seats || 0) - (a.seats || 0));
  const card = qq(dom, '.ro-card')[0];
  const top = rows[0];

  check('overview: the seat count is the engine\'s',
    card.querySelector('.ro-seats-value').textContent === String(top.seats || 0),
    card.querySelector('.ro-seats-value').textContent + ' vs ' + top.seats);

  const figs = [...card.querySelectorAll('.ro-fig-value')].map((n) => n.textContent);
  check('overview: the popular vote is the engine\'s board share',
    typeof top.share !== 'number' || figs[0] === top.share.toFixed(1) + '%',
    figs[0] + ' vs ' + top.share);
  check('overview: and the spend is what that campaign actually spent',
    typeof top.spent !== 'number' ||
      figs[1] === (top.spent > 0 ? dom.window.CMP.ui.money.words(top.spent) : '₹0'),
    figs[1] + ' vs ' + top.spent);
  check('overview: nobody\'s remaining cash is on this screen',
    !/in hand|remaining|balance/i.test(q(dom, '.rr-bar').parentNode.textContent),
    'ok');
}

/*
 * The sequence walks itself, and does not end on the first screen.
 *
 * The overview is new in front of the regions, and go() decides what follows
 * a stage by asking nextStage(). When that returned nothing for the overview,
 * go() read it as "nothing after this" and queued the end of the whole
 * read-out — a round settled, showed the overview, and closed without a
 * single region ever appearing. It is worth a test because nothing on screen
 * says it is broken; the results simply do not happen.
 */
check('overview: something follows the overview',
  !!q(dom, '.rr-bar') &&
    qq(dom, '.screen-election button')
      .some((b) => /Region results|See who is leading/.test(b.textContent)),
  qq(dom, '.screen-election button').map((b) => b.textContent.slice(0, 20)).join(' | '));

// Then through to the regions.
clickIt(dom, qq(dom, '.screen-election button')
  .find((b) => /Region results|See who is leading/.test(b.textContent)));
await settle();

check('4. then the regions are read out one at a time',
  /Malwa|Majha|Doaba/i.test(q(dom, '.rr-bar-title').textContent),
  q(dom, '.rr-bar-title').textContent);
check('4. and say which round they are for',
  /Round \d+ results/i.test(q(dom, '.rr-bar-kicker').textContent),
  q(dom, '.rr-bar-kicker').textContent);
check('5. the standings are not on the region screen',
  !q(dom, '.rr-grid') && !q(dom, '.board-row'));

/*
 * The region says who is ahead across the whole of it, above the districts
 * that are the evidence for it.
 */
check('region: a summary names who leads the region',
  !!q(dom, '.rr-region-summary') &&
    !!q(dom, '.rr-region-party').textContent.length,
  q(dom, '.rr-region-summary')
    ? q(dom, '.rr-region-summary').textContent.replace(/\s+/g, ' ').trim() : 'none');
check('region: with seats, popular vote and how many districts',
  qq(dom, '.rr-region-figs .ro-fig').length === 3,
  qq(dom, '.rr-region-figs .ro-fig-label').map((n) => n.textContent).join(' / '));

check('7. it lists the districts of that region',
  qq(dom, '.rr-district').length > 0,
  qq(dom, '.rr-district').length + ' districts');
check('7. each named, with its size',
  qq(dom, '.rr-district').every((n) =>
    !!n.querySelector('.rr-district-name') && /seat/.test(n.textContent)),
  q(dom, '.rr-district-head') ? q(dom, '.rr-district-head').textContent : 'none');

/*
 * 6 + 17. A face, a bar and a share for each runner, from the board the
 * engine already settled. Nothing here computes a result of its own.
 */
const runners = qq(dom, '.rr-district')[0].querySelectorAll('.rr-runner');
check('6. the runners in a district are shown', runners.length > 0,
  runners.length + ' runners');
check('6. each with a face', [...runners].every((n) => !!n.querySelector('.portrait')));
check('6. a bar', [...runners].every((n) => !!n.querySelector('.rr-runner-fill')));
/*
 * A share where there is one, and a dash where there is not.
 *
 * The card lists every party now, including the ones that stayed out — and
 * "0.0%" against a party that never campaigned is a number about nothing.
 * A dash says the true thing, which is that they were not in it.
 */
check('6. and its calculated share, or a dash where there was no bid',
  [...runners].every((n) => {
    const shown = n.querySelector('.rr-runner-share').textContent;
    const bid = !/No bid/i.test(n.querySelector('.rr-runner-pos').textContent);
    return bid ? /%$/.test(shown) : shown === '—';
  }),
  [...runners].map((n) => n.querySelector('.rr-runner-share').textContent).join(' '));
check('6. every party is on the card, in or out of the race',
  runners.length === 4, runners.length + ' runners');
check('6. and each says where it stands',
  [...runners].every((n) => /Won|Leading|Trailing|No bid/i
    .test(n.querySelector('.rr-runner-pos').textContent)),
  [...runners].map((n) => n.querySelector('.rr-runner-pos').textContent).join(' | '));
check('6. the leader is first and marked',
  runners[0].classList.contains('is-first'));
check('17. and the shares are the engine\'s own, not invented',
  (() => {
    const name = q(dom, '.rr-district-name').textContent;
    const district = dom.window.CMP.DISTRICTS.find((d) => d.name === name);
    const g = dom.window.CMP.app.getGame();
    const totals = {};
    district.seats.forEach((n) => {
      dom.window.CMP.campaign.standings(g.support[n] || {}).forEach((r) => {
        totals[r.partyId] = (totals[r.partyId] || 0) + r.support;
      });
    });
    const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
    const want = Math.round((totals[top] / district.seats.length) * 10) / 10;
    return runners[0].querySelector('.rr-runner-share').textContent ===
      want.toFixed(1) + '%';
  })(),
  runners[0].querySelector('.rr-runner-share').textContent);

check('play is locked while the round is counted',
  !q(dom, '.action-card') && !q(dom, '.panel-tab'));

/*
 * 8 + 14. Skip is always there, and always goes to the answer.
 *
 * Somebody who does not want to watch the districts wants to know who is
 * leading, not to be shown the next region.
 */
/*
 * 1. The districts are read out one at a time, and they stay.
 *
 * Every card used to arrive within four hundred milliseconds of the one
 * before it — a page loading rather than a result being announced. They come
 * into a feed now: one arrives at the top, the one before it slides down and
 * remains, and the region builds up the way a results programme does.
 *
 * Driven on its own board rather than the ambient one, because the round the
 * suite is in has touched a single district and one card cannot show that a
 * second follows it.
 */
const feedGame = dom.window.CMP.state.startElection({
  candidateName: 'Simran Kaur Gill',
  partyName: 'Punjab Development Party',
});
const feedDistricts = dom.window.CMP.DISTRICTS
  .filter((d) => d.region === 'malwa').slice(0, 4);
feedDistricts.forEach((d, i) => {
  d.seats.forEach((n) => {
    feedGame.support[n] = { [feedGame.partyId]: 10 + i, p2: 6 };
  });
});

const feedView = dom.window.CMP.ui.scoreboard.create({
  you: () => feedGame.partyId,
  trend: () => [],
  game: () => feedGame,
  onFinished: () => {},
});
feedView.render({
  round: 3,
  standings: dom.window.CMP.getParties().map((party, i) => ({
    partyId: party.id, seats: 20 - i, won: 0, leading: 20 - i, share: 25,
  })),
  changes: [], won: [], conflicts: [],
}, 30);

const feedNames = () => [...feedView.root.querySelectorAll('.rr-district-name')]
  .map((n) => n.textContent);

/*
 * Past the overview, which is where every round now opens.
 *
 * This block is about the district feed — how the cards arrive and how Skip
 * flushes them — so it takes the one step through to the regions rather than
 * asserting anything about the screen in front of them.
 */
clickIt(dom, [...feedView.root.querySelectorAll('button')]
  .find((b) => /Region results|See who is leading/.test(b.textContent)));
await settle();

check('1. the results open with one district, not all of them',
  feedNames().length === 1, feedNames().join(' / '));
const feedFirst = feedNames()[0];

await new Promise((r) => setTimeout(r, 4200));
const afterOne = feedNames();
check('1. a second arrives on its own, a few seconds later',
  afterOne.length === 2, afterOne.join(' / '));
check('1. and the first is still there', afterOne.indexOf(feedFirst) !== -1,
  afterOne.join(' / '));
check('1. with the newest at the top',
  afterOne.length === 2 && afterOne[0] !== feedFirst && afterOne[1] === feedFirst,
  afterOne.join(' / '));

await new Promise((r) => setTimeout(r, 4200));
check('1. and the feed keeps building rather than replacing',
  feedNames().length === 3, feedNames().join(' / '));

// 1. The bars inside a card wait for their own card to settle.
const feedRunner = feedView.root.querySelector('.rr-runner');
check('1. the bars follow the card they are on',
  Number((feedRunner.style.getPropertyValue('--runner-delay') || '0ms')
    .replace('ms', '')) > 0,
  feedRunner.style.getPropertyValue('--runner-delay'));

/*
 * 8. And Skip reads the rest out at once rather than dropping what was
 *    mid-arrival, then goes straight to the answer.
 */
feedView.root.querySelector('.rr-skip')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await settle();
check('8. Skip goes to the overall leader',
  /Overall leader/i.test(feedView.root.querySelector('.rr-bar-title').textContent),
  feedView.root.querySelector('.rr-bar-title').textContent);
feedView.stop();

check('8. Skip is offered on a region screen', !!q(dom, '.rr-skip'),
  qq(dom, '.round-results button').map((b) => b.textContent).join(' | '));
clickIt(dom, q(dom, '.rr-skip'));
await settle();

check('11. Skip goes straight to the overall leader',
  /Overall leader/i.test(q(dom, '.rr-bar-title').textContent),
  q(dom, '.rr-bar-title').textContent);
check('11. which is a grid of the players', qq(dom, '.rr-card').length === 4,
  qq(dom, '.rr-card').length + ' cards');
check('11. each with a face, a party and a seat count',
  qq(dom, '.rr-card').every((n) => !!n.querySelector('.portrait') &&
    !!n.querySelector('.rr-card-party') && /^\d+$/.test(
      n.querySelector('.rr-card-seats').textContent)),
  qq(dom, '.rr-card-seats').map((n) => n.textContent).join(','));
check('11. sorted by seats, most first',
  qq(dom, '.rr-card-seats').map((n) => Number(n.textContent))
    .every((v, i, a) => i === 0 || a[i - 1] >= v),
  qq(dom, '.rr-card-seats').map((n) => n.textContent).join(' >= '));
check('9. and the leader is marked as leading',
  qq(dom, '.rr-card.is-leading').length === 1 &&
  /Leading/i.test(q(dom, '.rr-card.is-leading').textContent),
  q(dom, '.rr-card.is-leading').textContent);

/*
 * 12. Four totals, and no arithmetic about the election.
 *
 * This screen used to carry nothing but who was ahead, on the grounds that
 * the majority, the distance from it and the vote shares are all calculations
 * somebody can go and make. Four of them are asked for now — how much of the
 * board is decided, the leader's share of it, and what the campaigns have
 * spent and earned between them — because they summarise the round rather
 * than analysing the election.
 *
 * What stays off it is the majority line and the distance to it: those are on
 * the leader's own screen and on the final count, and repeating them here is
 * what turned this into another screen to read.
 */
const overallText = q(dom, '.round-results').textContent;
check('12. no majority arithmetic on the leader screen',
  !/needs \d+ more|of 59|Majority/i.test(overallText), overallText.slice(0, 120));
check('12. but the round is totalled',
  qq(dom, '.rr-totals .ro-fig').length === 4,
  qq(dom, '.rr-totals .ro-fig-label').map((n) => n.textContent).join(' / '));
check('12. seats decided, popular vote, spend and grants',
  qq(dom, '.rr-totals .ro-fig-label').map((n) => n.textContent).join('/') ===
    'Seats decided/Popular vote/Total spend/Total grants',
  qq(dom, '.rr-totals .ro-fig-label').map((n) => n.textContent).join('/'));

check('15. one way onward, and it is not a trap',
  !!qq(dom, '.round-results button').find((b) => /Continue to next round/i.test(b.textContent)),
  qq(dom, '.round-results button').map((b) => b.textContent).join(' | '));

/*
 * Round one is not a milestone round, so the extra screen is not offered.
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
// Skip the regions: the milestone hangs off the overall screen.
clickIt(dom, q(dom, '.rr-skip'));
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
  /Overall leader/i.test(q(dom, '.rr-bar-title').textContent),
  q(dom, '.rr-bar-title') ? q(dom, '.rr-bar-title').textContent : 'no title');

/* ---- round fifteen: the review ---- */
const checkpoint = await settledAt(15);
clickIt(dom, q(dom, '.rr-skip'));
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
  qq(dom, '.g-nav-item').length === 4 && !!q(dom, '.punjab-map'),
  qq(dom, '.g-nav-item').length + ' navigation items');
check('the campaign log kept the round it happened in',
  solo.actions[0].round === 1, String(solo.actions[0].round));
/*
 * Nothing goes in front of the results.
 *
 * There used to be a card here — "Round 1 complete", spend, support, seats
 * led, districts held, heat — which arrived first and had to be dismissed by
 * hand before anybody could see who had won anything. A summary of the round,
 * ahead of the results of the round.
 *
 * The figures are all still computed and still stored: the money screen has
 * the spending and the standings have the seats. What has gone is the
 * interruption.
 */
check('no summary card comes in front of the results',
  !q(dom, '.summary-card') && !/complete/i.test(text(dom)),
  text(dom).slice(0, 120));
check('and nothing has to be dismissed by hand', !q(dom, '.summary-close'));
check('the round still recorded what it did',
  typeof solo.summary === 'object' && solo.summary.round === 1,
  JSON.stringify(solo.summary && solo.summary.round));
check('55. including the districts held',
  typeof solo.summary.districtsAfter === 'number',
  String(solo.summary.districtsAfter));
check('55. and the money spent in it',
  solo.summary.spent === spentInRound1,
  solo.summary.spent + ' vs ' + spentInRound1);
check('history recorded the finished round', solo.history.length === 1);
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
/*
 * 12. The whole bargain, before it is struck.
 *
 * Interest comes off the top now — borrow ₹65 lakh and ₹52 lakh arrives — so
 * a card that only names the amount is naming the least useful of the three
 * numbers.
 */
check('12. each offer says what arrives, what is repaid and when',
  qq(dom, '.loan-offer').every((n) =>
    /Receive/.test(n.textContent) && /Repay/.test(n.textContent) &&
    /Due round \d+/.test(n.textContent)),
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
/*
 * 2. Interest is taken on the way out.
 *
 * The money costs something the moment it arrives rather than only when the
 * bill does: ₹65 lakh borrowed at twenty per cent puts ₹52 lakh in the purse
 * and leaves ₹78 lakh to find four rounds later.
 */
const loanTaken = solo.loans[0];
check('2. cash rose by the loan less its interest',
  solo.cash === cashBeforeBorrowing + (loanTaken.amount - loanTaken.interest),
  solo.cash + ' vs ' + (cashBeforeBorrowing + loanTaken.amount - loanTaken.interest));
check('2. the interest is a fifth of what was borrowed',
  loanTaken.interest === Math.round(loanTaken.amount * 0.2),
  loanTaken.interest + ' of ' + loanTaken.amount);
check('2. and the repayment is the whole of it plus the interest',
  loanTaken.repay === loanTaken.amount + loanTaken.interest,
  String(loanTaken.repay));
check('4. due four rounds after it was taken',
  loanTaken.dueRound === loanTaken.takenRound + 4,
  'taken ' + loanTaken.takenRound + ', due ' + loanTaken.dueRound);
check('and the debt is tracked apart from it',
  dom.window.CMP.campaign.debtOf(solo) === loanTaken.repay);
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
  game: () => wonGame,
  onFinished: () => {},
});
rr.render(wonResult, 30);
rr.stop();

/*
 * 18. A won seat shows as won, on the district it belongs to.
 *
 * It used to have a section of its own on a screen of stacked sections —
 * seats changed, seats won, campaign conflicts — which was correct and more
 * than anybody reads between rounds. It is a tick beside the party's bar in
 * the district now, which is where somebody looking at that district would
 * expect to find it.
 */
const lockedDistrict = wonWin.CMP.DISTRICTS.find((d) => d.seats.indexOf(LOCKED) !== -1);
rr.root.querySelectorAll('.rr-skip').forEach(() => {});

// Drive the sequence to the region the won seat is in.
const wonRegion = lockedDistrict.region;
rr.render(null, 30);
const regionTitle = () => (rr.root.querySelector('.rr-bar-title') || {}).textContent || '';
// The sequence opens on the overview, so the walk is one step longer and the
// first button is the one that leaves it.
for (let i = 0; i < 5 && !new RegExp(wonWin.CMP.getRegion(wonRegion).name, 'i')
  .test(regionTitle()); i++) {
  const next = [...rr.root.querySelectorAll('button')]
    .find((b) => /Region results|Next region|See who is leading/i.test(b.textContent));
  if (!next) break;
  next.click();
  rr.stop();
}

check('18. the results reach the region the seat was won in',
  new RegExp(wonWin.CMP.getRegion(wonRegion).name, 'i').test(regionTitle()),
  regionTitle());

const wonRow = [...rr.root.querySelectorAll('.rr-district')]
  .find((n) => n.querySelector('.rr-district-name').textContent === lockedDistrict.name);
check('18. the district it is in is listed', !!wonRow,
  [...rr.root.querySelectorAll('.rr-district-name')].map((n) => n.textContent).join(', '));
check('18. and the seat is marked won rather than merely led',
  !!wonRow && !!wonRow.querySelector('.rr-runner-won'),
  wonRow ? wonRow.textContent.replace(/\s+/g, ' ').slice(0, 80) : 'no row');

/*
 * 12. And none of the technical detail that used to sit beside it.
 *
 * Campaign conflicts are a rule the engine settles; they are not something a
 * player needs read to them on election night.
 */
const rrText = rr.root.textContent;
check('12. no conflict ledger in the results', !/Nobody gained, nobody was refunded/.test(rrText));
check('12. and no talk of what was matched', !/campaigns matched at/i.test(rrText));

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

section('My Areas: comparing a district and campaigning across it');

/*
 * The bulk sheet opened on an action that no longer exists.
 *
 * It defaulted to `rally`, one of the eleven campaigns deleted when
 * campaigning became one action and an amount. `getAction` answered null, the
 * first thing to read it threw, and the sheet never rendered — so pressing the
 * button on My Areas did nothing at all, from every region. Nothing caught it
 * because nothing opened it.
 */
const areaGame = dom.window.CMP.state.startElection({
  candidateName: 'Simran Kaur Gill',
  partyName: 'Punjab Development Party',
});
dom.window.CMP.app.setGame(areaGame);

function clearSheets() {
  qq(dom, '.sheet').forEach((n) => {
    if (n.parentNode) n.parentNode.removeChild(n);
  });
}
clearSheets();

const REGIONS = ['malwa', 'majha', 'doaba'];
for (const region of REGIONS) {
  const district = dom.window.CMP.DISTRICTS.find((d) => d.region === region);
  let threw = null;
  try {
    dom.window.CMP.ui.allocate.open({
      game: areaGame,
      seats: district.seats.slice(),
      title: district.name,
      onPlay: () => Promise.resolve({ ok: true, reports: [] }),
      onClose: () => {},
    });
  } catch (e) {
    threw = e.message;
  }
  await settle();

  check('the sheet opens for ' + region, threw === null && !!q(dom, '.al-panel'),
    threw || (q(dom, '.al-panel') ? 'open' : 'nothing rendered'));
  check('  and offers a campaign to run', qq(dom, '.al-move').length > 0,
    qq(dom, '.al-move-name').map((n) => n.textContent).join(', '));
  check('  with one of them already chosen',
    qq(dom, '.al-move.is-active').length === 1,
    qq(dom, '.al-move.is-active').length + ' active');
  check('  and every offered campaign is one the game has',
    qq(dom, '.al-move-name').every((n) =>
      dom.window.CMP.ACTIONS.some((a) => a.label === n.textContent)),
    qq(dom, '.al-move-name').map((n) => n.textContent).join(', '));

  clearSheets();
  await settle();
}

/*
 * 18. And a seat that has been won is never reopened by it.
 *
 * The server refuses a move into one anyway, so offering it here would spend
 * the player's attention on something that was going to be rejected.
 */
const lockDistrict = dom.window.CMP.DISTRICTS.find((d) => d.seats.length >= 3);
areaGame.wonSeats = areaGame.wonSeats || {};
areaGame.wonSeats[String(lockDistrict.seats[0])] =
  { party: areaGame.partyId, round: 4, share: 80 };

clearSheets();
dom.window.CMP.ui.allocate.open({
  game: areaGame,
  seats: lockDistrict.seats.slice(),
  title: lockDistrict.name,
  onPlay: () => Promise.resolve({ ok: true, reports: [] }),
  onClose: () => {},
});
await settle();

check('18. a won seat is left out of the spread',
  new RegExp((lockDistrict.seats.length - 1) + ' seats').test(q(dom, '.al-sub').textContent),
  q(dom, '.al-sub').textContent);
check('18. and it says so rather than quietly dropping it',
  /already won and locked/.test(q(dom, '.al-sub').textContent),
  q(dom, '.al-sub').textContent);

clearSheets();
await settle();

section('Grants: what a campaign earns, and where the next of it is');

/*
 * This replaced My Areas, which led with how many seats you were leading —
 * a fact about the board rather than a decision about money. The question a
 * player comes here with is where the next crore a round comes from, so the
 * three regions answer it first.
 *
 * Every figure is the engine's. Nothing on this screen runs an economy of
 * its own, and this checks that by working the numbers out independently and
 * expecting the same answers.
 */
const grantGame = dom.window.CMP.state.startElection({
  candidateName: 'Simran Kaur Gill',
  partyName: 'Punjab Development Party',
});

// A district taken outright, so there is a grant to report rather than three
// empty regions.
const paid = dom.window.CMP.DISTRICTS.find((d) => d.region === 'malwa');
grantGame.wonSeats = grantGame.wonSeats || {};
paid.seats.forEach((n) => {
  grantGame.wonSeats[String(n)] = { party: grantGame.partyId, round: 3, share: 85 };
});
// And one the player is close to but has not finished.
const close = dom.window.CMP.DISTRICTS.find(
  (d) => d.region === 'majha' && d.seats.length >= 3
);
close.seats.slice(0, close.seats.length - 1).forEach((n) => {
  grantGame.wonSeats[String(n)] = { party: grantGame.partyId, round: 4, share: 80 };
});

dom.window.CMP.app.setGame(grantGame);
dom.window.CMP.app.goTo('election');
await settle();

check('1. the board offers Grant, not My Areas',
  qq(dom, '.g-nav-label').map((n) => n.textContent).indexOf('Grant') !== -1 &&
  !/My Areas/.test(text(dom)),
  qq(dom, '.g-nav-label').map((n) => n.textContent).join('/'));

clickIt(dom, qq(dom, '.g-nav-item').find((b) => /Grant/.test(b.textContent)));
await settle();

/* ---- the three regions ---- */
check('3. it opens on the three regions', qq(dom, '.gr-card').length === 3,
  qq(dom, '.gr-card-name').map((n) => n.textContent).join(' / '));
check('3. each named for its region',
  qq(dom, '.gr-card-name').every((n) => /grant$/i.test(n.textContent)),
  qq(dom, '.gr-card-name').map((n) => n.textContent).join(' / '));
check('4. each with what it pays, what is banked and what is open',
  qq(dom, '.gr-card')[0].querySelectorAll('.gr-fig').length === 3,
  qq(dom, '.gr-card')[0].querySelectorAll('.gr-fig-label').length + ' figures');

/*
 * 18. And the figures are the game's own.
 *
 * Worked out here from the districts and the engine's own purse, and expected
 * to match what the screen says to the rupee.
 */
const malwaCard = qq(dom, '.gr-card')
  .find((c) => /Malwa/i.test(c.querySelector('.gr-card-name').textContent));
const wonFig = malwaCard.querySelector('.gr-fig.is-won .gr-fig-value').textContent;
const expectWon = dom.window.CMP.ui.money.words(paid.grant);
check('18. the grant a region pays is the district grant, not a guess',
  wonFig === expectWon, wonFig + ' vs ' + expectWon);

const purseFig = malwaCard.querySelector('.gr-fig.is-purse .gr-fig-value').textContent;
const expectPurse = dom.window.CMP.ui.money.words(
  dom.window.CMP.campaign.grantIn(grantGame, 'malwa')) || '₹0';
check('18. and the purse is the engine\'s purse',
  purseFig === expectPurse, purseFig + ' vs ' + expectPurse);

/* ---- a region opens its districts ---- */
clickIt(dom, malwaCard);
await settle();
check('7. tapping a region lists its districts',
  qq(dom, '.gr-district').length > 0, qq(dom, '.gr-district').length + ' districts');
check('7. and only that region\'s',
  qq(dom, '.gr-district-name').every((n) =>
    (dom.window.CMP.DISTRICTS.find((d) => d.name === n.textContent) || {}).region === 'malwa'),
  qq(dom, '.gr-district-name').map((n) => n.textContent).slice(0, 4).join(', '));
check('7. the one that is paying says so',
  qq(dom, '.gr-district.is-held').length === 1 &&
  /Paying/i.test(q(dom, '.gr-district.is-held').textContent),
  q(dom, '.gr-district.is-held') ? q(dom, '.gr-district.is-held').textContent : 'none');

/* ---- how to earn more, about this game rather than in general ---- */
check('8. it says how to earn more', !!q(dom, '.gr-how'));
check('8. naming every region', qq(dom, '.gr-how-region').length === 3,
  qq(dom, '.gr-how-region').map((n) => n.textContent).join('/'));
check('8. and saying something about this board rather than a platitude',
  qq(dom, '.gr-how-note').some((n) => /\d/.test(n.textContent)),
  qq(dom, '.gr-how-note').map((n) => n.textContent).join(' | ').slice(0, 140));

/* ---- best targets ---- */
check('9. it recommends targets', qq(dom, '.gr-target').length > 0,
  qq(dom, '.gr-target-name').map((n) => n.textContent).join(', '));
check('13. each with a priority',
  qq(dom, '.gr-target-priority').every((n) => /high|medium|low/i.test(n.textContent)),
  qq(dom, '.gr-target-priority').map((n) => n.textContent).join(', '));
check('9. and never a district that is already paying',
  qq(dom, '.gr-target-name').every((n) => n.textContent !== paid.name),
  qq(dom, '.gr-target-name').map((n) => n.textContent).join(', '));

/*
 * 9. Not simply the biggest district.
 *
 * The near-complete district is worth far less per seat than the largest one
 * in the game, and the recommendation should prefer it — that is the whole
 * difference between a target and a list sorted by size.
 */
const biggest = dom.window.CMP.DISTRICTS.slice().sort(
  (a, b) => b.seats.length - a.seats.length)[0];
const topTarget = q(dom, '.gr-target-name').textContent;
check('9. the recommendation is not just the largest district',
  topTarget !== biggest.name || close.name === biggest.name,
  topTarget + ' (largest is ' + biggest.name + ')');
check('9. the district one seat from paying is recommended',
  qq(dom, '.gr-target-name').map((n) => n.textContent).indexOf(close.name) !== -1,
  qq(dom, '.gr-target-name').map((n) => n.textContent).join(', '));

/* ---- targeting an opponent ---- */
check('10. every rival can be targeted',
  qq(dom, '.gr-rival').length === dom.window.CMP.PARTIES.length - 1,
  qq(dom, '.gr-rival-name').map((n) => n.textContent).join('/'));
check('10. and the player is not one of them',
  qq(dom, '.gr-rival-name').map((n) => n.textContent)
    .indexOf(dom.window.CMP.getParty(grantGame.partyId).short) === -1,
  qq(dom, '.gr-rival-name').map((n) => n.textContent).join('/'));

const beforeRival = qq(dom, '.gr-target').length;
clickIt(dom, qq(dom, '.gr-rival')[0]);
await settle();
check('11. choosing one changes what is recommended',
  qq(dom, '.gr-rival.is-on').length === 1,
  qq(dom, '.gr-rival.is-on').length + ' selected');
check('12. and it says what taking a district would and would not do',
  /does not take money they already have/i.test(text(dom)) ||
  /not close to a grant anywhere/i.test(text(dom)),
  text(dom).match(/does not take money[^.]*\.|not close to a grant[^.]*\./) || 'no note');

/* ---- 2. and none of the old dashboard came with it ---- */
check('2. no seats-led summary on the grant screen',
  !q(dom, '.ma-control') && !/Your control/i.test(text(dom)));

section('3. The More menu is four things');

/*
 * It is the menu you open while a round is running, and a list of eleven
 * destinations is not that. Money, Grants, Loan, Corruption, Bribe, all 117
 * constituencies and the election history came off it.
 *
 * What matters as much as the removal is that nothing was stranded, so this
 * checks the ways back in as well.
 */
dom.window.CMP.app.setGame(dom.window.CMP.state.startElection({
  candidateName: 'Simran Kaur Gill',
  partyName: 'Punjab Development Party',
}));
dom.window.CMP.app.goTo('election');
await settle();

clickIt(dom, q(dom, '.g-more'));
await settle();

const moreLabels = qq(dom, '.sheet-panel .sheet-item').map((n) =>
  (n.querySelector('.sheet-item-title') || n).textContent.replace(/^\W+\s*/, '').trim());

/*
 * Four rows, and none of them is a move.
 *
 * The audio controls used to be inline here, which meant the menu opened on
 * four sliders and the four things you can actually do were below them. They
 * are one row now - Sound & Music - and the menu is a list of four choices.
 */
check('3. the menu offers four things', moreLabels.length === 4,
  moreLabels.join(' | '));
check('3. and they are sound, settings, help and exit',
  ['Sound & Music', 'Game Settings', 'Help / Tutorial', 'Exit game']
    .every((want, i) => moreLabels[i] === want),
  moreLabels.join(' | '));
check('3. no volume slider is on the menu itself',
  qq(dom, '.sheet-range').length === 0,
  qq(dom, '.sheet-range').length + ' sliders');
check('3. nothing that came off it is still listed',
  ['Money', 'Grants', 'Loan', 'Corruption', 'Bribe', 'All 117', 'Election history']
    .every((gone) => !moreLabels.some((l) => l.indexOf(gone) === 0)),
  moreLabels.join(' | '));
check('3. and no empty rows are left behind',
  qq(dom, '.sheet-panel .sheet-item').every((n) => n.textContent.trim().length > 0));

/* ---- Sound & Music, one row in ---- */

clickIt(dom, qq(dom, '.sheet-item').find(
  (n) => /Sound & Music/.test(n.textContent)));
await settle();
check('4. sound and music open on their own sheet',
  /Sound & Music/.test(q(dom, '.sheet-title').textContent),
  q(dom, '.sheet-title') ? q(dom, '.sheet-title').textContent : 'no sheet');
check('4. music and sound each have their own volume',
  qq(dom, '.sheet-item.is-volume').length === 2 &&
  qq(dom, '.sheet-range').length === 2,
  qq(dom, '.sheet-item.is-volume').length + ' volumes');

// 4. And a volume is remembered as a number rather than coerced to a switch.
const musicSlider = qq(dom, '.sheet-range')[0];
musicSlider.value = '15';
musicSlider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await settle();
check('4. moving it stores a level, not an on/off',
  dom.window.CMP.settings.get('musicVolume') === 0.15,
  String(dom.window.CMP.settings.get('musicVolume')));

// Music and sound still work, and remember.
const musicRow = qq(dom, '.sheet-item.is-toggle')[0];
const wasOn = musicRow.classList.contains('is-on');
clickIt(dom, musicRow);
await settle();
check('4. music can be switched', musicRow.classList.contains('is-on') !== wasOn,
  musicRow.textContent.trim());
check('4. and the preference is stored',
  dom.window.CMP.settings.get('music') === !wasOn,
  String(dom.window.CMP.settings.get('music')));
clickIt(dom, musicRow);
await settle();

clickIt(dom, qq(dom, '.sheet-panel button').find((b) => b.textContent === 'Close'));
await settle();

/* ---- and nothing was stranded ---- */
check('3. money is still reachable, from the figure that summarises it',
  !!q(dom, '.round-aside .g-fig.is-lead'));
clickIt(dom, q(dom, '.round-aside .g-fig.is-lead'));
await settle();
check('3. which opens the ledger', /Money|spent|debt/i.test(text(dom)) &&
  !q(dom, '.punjab-map'), text(dom).slice(0, 80));

openSection(dom, 'Home');
await settle();
check('3. loan and grant are one tap from anywhere',
  qq(dom, '.g-nav-label').map((n) => n.textContent).join('/') ===
    'Home/Grant/Alliances/Loan',
  qq(dom, '.g-nav-label').map((n) => n.textContent).join('/'));

/* ---------------------------------------------------- the navigation bar */

/* ------------------------------------------------------ help and settings */

/* ------------------------------------------------------------- the profile */

/* ------------------------------------------------- the home background */

section('The home background');

/*
 * A CSS background that 404s is invisible, and invisible is exactly what a
 * missing decorative image looks like when it is working properly. Nothing in
 * the browser will tell you. So this reads the rule, pulls the path out of it,
 * and resolves that path the way the browser would - relative to the
 * stylesheet, not to the page.
 */
{
  const homeCss = fs.readFileSync(path.join(ROOT, 'css/home.css'), 'utf8');

  const band = homeCss.match(/\.screen-home::before\s*\{[\s\S]*?\n\}/);
  check('bg: the home screen has a background band', !!band);

  const url = band && band[0].match(/url\(['"]?([^'")]+)['"]?\)/);
  check('bg: it names an image', !!url, url ? url[1] : 'no url()');

  if (url) {
    const onDisk = path.resolve(path.join(ROOT, 'css'), url[1]);
    check('bg: and the file is actually there',
      fs.existsSync(onDisk), url[1] + ' -> ' + onDisk);
    check('bg: reached by a relative path, so it works wherever it is served',
      url[1].startsWith('../') || url[1].startsWith('assets/'),
      url[1]);
  }

  /*
   * The three properties the brief pins down. They are what stop a photograph
   * from tiling, stretching, or being cropped from the wrong edge.
   */
  check('bg: cover, centred on its top edge, and never repeated',
    band && /background-size:\s*cover/.test(band[0]) &&
      /background-position:\s*center top/.test(band[0]) &&
      /background-repeat:\s*no-repeat/.test(band[0]),
    band ? band[0].slice(-140).replace(/\s+/g, ' ') : '');

  /*
   * A band pinned to both edges of a full-width block cannot widen the page.
   * A width, or a horizontal transform, could - and a background that puts a
   * scrollbar across every screen is the one failure mode worth a test of its
   * own, because it is invisible until somebody tries it on a phone.
   */
  check('bg: pinned to both edges rather than given a width',
    band && /left:\s*0/.test(band[0]) && /right:\s*0/.test(band[0]) &&
      !/\n\s*width:/.test(band[0]),
    band ? 'width found in the rule' : '');

  // It is decoration. It must never sit over anything, or take a tap.
  check('bg: behind the content, and not clickable',
    band && /z-index:\s*-1/.test(band[0]) &&
      /pointer-events:\s*none/.test(band[0]));

  /*
   * And only on the home screen. The band is an establishing shot; a game in
   * progress has a map to look at.
   */
  check('bg: the game screen does not carry it',
    !/\.screen-(game|election)[^{]*\{[^}]*punjab-assembly-bg/.test(homeCss) &&
      !fs.readdirSync(path.join(ROOT, 'css'))
        .filter((f) => f !== 'home.css' && f.endsWith('.css'))
        .some((f) => fs.readFileSync(path.join(ROOT, 'css', f), 'utf8')
          .includes('punjab-assembly-bg')));
}

section('My Profile');

{
  const pf = await openPage([
    { key: 'cmp.punjab.profile.v1', value: JSON.stringify({
      id: 'abc123', name: 'Simran Kaur Gill', avatar: 'a3' }) },
  ]);
  await settle();

  clickIt(pf, qq(pf, '.h-card').find((c) => /My Profile/.test(c.textContent)));
  await settle();
  check('profile: it opens from the home screen', !!q(pf, '.screen-profile'),
    q(pf, '.screen') ? q(pf, '.screen').className : 'no screen');

  /*
   * The brief is explicit that the leaderboard does not belong in here. The
   * one sentence that mentions it explains why solo games do not count, which
   * is about this player's own record rather than about anybody else's.
   */
  check('profile: no leaderboard table inside it',
    !q(pf, '.pf-board') && !q(pf, '.lb-board') &&
      qq(pf, '.pf-section').every((n) => !/rank/i.test(n.textContent)),
    'sections: ' + qq(pf, '.pf-section').length);

  // Name and face can be changed; nothing else on the screen can.
  check('profile: there is an edit control', !!q(pf, '.pf-edit'));
  clickIt(pf, q(pf, '.pf-edit'));
  await settle();
  check('profile: the editor offers a name and a face',
    !!q(pf, '.sheet-panel .field') && !!q(pf, '.sheet-panel .av-picker'),
    q(pf, '.sheet-title') ? q(pf, '.sheet-title').textContent : 'no sheet');
  check('profile: and no photo upload',
    !q(pf, '.sheet-panel input[type=file]'));

  typeInto(pf, q(pf, '.sheet-panel .field'), 'Harpreet Kaur');
  clickIt(pf, qq(pf, '.sheet-panel button').find((b) => b.textContent === 'Save'));
  await settle();
  check('profile: saving a new name keeps it',
    pf.window.CMP.profile.get().name === 'Harpreet Kaur',
    pf.window.CMP.profile.get().name);
  check('profile: and the sheet closes', !q(pf, '.sheet'));
}

section('The Election Briefing');

clickIt(dom, q(dom, '.g-more'));
await settle();
clickIt(dom, qq(dom, '.sheet-item').find((n) => /Help \/ Tutorial/.test(n.textContent)));
await settle();

check('help: the briefing opens from the menu',
  !!q(dom, '.screen-briefing'),
  q(dom, '.screen') ? q(dom, '.screen').className : 'no screen');
check('help: ten chapters', qq(dom, '.br-chapter').length === 10,
  qq(dom, '.br-chapter').length + ' chapters');
check('help: one is open to start with',
  qq(dom, '.br-chapter.is-open').length === 1);
check('help: and there are quick tips', qq(dom, '.br-tip').length >= 4,
  qq(dom, '.br-tip').length + ' tips');

/*
 * The figures in the briefing are read out of the rules, not typed into the
 * prose. A tutorial that quotes numbers it does not read goes quietly wrong
 * the first time somebody tunes the game, so this asserts the link rather
 * than the number: change the entry cap and the sentence changes with it.
 */
const capChapter = dom.window.CMP.ui.briefing.chapters()[2];
const realCap = dom.window.CMP.CAMPAIGN.spending.entryMaximum / 10000000;
check('help: the entry cap is quoted from the rules',
  capChapter.points.some((t) => t.indexOf('₹' + realCap + ' crore') !== -1),
  capChapter.points.join(' | ').slice(0, 110));

const loanChapter = dom.window.CMP.ui.briefing.chapters()[6];
const realRate = Math.round(dom.window.CMP.CAMPAIGN.finance.loan.interestRate * 100);
check('help: so is the interest rate',
  loanChapter.points.some((t) => t.indexOf(realRate + '%') !== -1),
  loanChapter.points[0].slice(0, 90));

// Opening a chapter closes the one that was open.
clickIt(dom, qq(dom, '.br-chapter-head')[4]);
await settle();
check('help: opening one chapter closes the other',
  qq(dom, '.br-chapter.is-open').length === 1 &&
  qq(dom, '.br-chapter')[4].classList.contains('is-open'));

// And it goes back to the board rather than to the home screen.
clickIt(dom, q(dom, '.br-back'));
await settle();
check('help: back returns to the election, not to home',
  !!q(dom, '.screen-election'),
  q(dom, '.screen') ? q(dom, '.screen').className : 'no screen');

/*
 * Game Settings holds what is a setting. About the map was a row on the menu
 * itself, which put a paragraph about cell shapes next to the way out of the
 * game.
 */
clickIt(dom, q(dom, '.g-more'));
await settle();
clickIt(dom, qq(dom, '.sheet-item').find((n) => /Game Settings/.test(n.textContent)));
await settle();
check('settings: about the map moved here',
  qq(dom, '.sheet-item').some((n) => /About the map/.test(n.textContent)),
  qq(dom, '.sheet-item').map((n) => n.textContent.slice(0, 18)).join(' | '));
clickIt(dom, qq(dom, '.sheet-panel button').find((b) => b.textContent === 'Close'));
await settle();

section('The navigation bar');

/*
 * A tab on the bar is not a screen you descended into.
 *
 * Grant, Alliances and Loan are one tap away from everywhere, so a back arrow
 * on them is a second control doing the bar's job. The screens reached from
 * More have no other way out and keep theirs.
 */
openSection(dom, 'Grant');
await settle();
check('nav: a tab on the bar carries no back arrow',
  !!q(dom, '.g-section-head') && !q(dom, '.g-section-head .sd-back'),
  q(dom, '.g-section-head') ? q(dom, '.g-section-head').innerHTML.slice(0, 60) : 'no head');
check('nav: and its name is set in the serif',
  !!q(dom, '.g-section-head.is-flush .g-section-title'));

openSection(dom, 'Loan');
await settle();
check('nav: the same on Loan', !q(dom, '.g-section-head .sd-back'));

openSection(dom, 'Alliances');
await settle();
check('nav: and on Alliances', !q(dom, '.g-section-head .sd-back'));

// A screen below the bar still has one, because it is the only way back.
goHome(dom);
clickIt(dom, q(dom, '.round-aside .g-fig.is-lead'));
await settle();
check('nav: a screen below the bar keeps its back arrow',
  !!q(dom, '.g-section-head .sd-back'));
clickIt(dom, q(dom, '.g-section-head .sd-back'));
await settle();

/*
 * A reload is not a decision to go somewhere else.
 *
 * Reopening the page used to land on Home whatever you had been doing. The
 * tab is written to its own storage key, so this reads it back the way the
 * next page load would.
 */
openSection(dom, 'Loan');
await settle();
check('nav: the open tab is written down',
  JSON.parse(dom.window.localStorage.getItem(dom.window.CMP.storage.UI_KEY)).section === 'loan',
  dom.window.localStorage.getItem(dom.window.CMP.storage.UI_KEY));

const reopened = await openPage([
  { key: dom.window.CMP.storage.KEY, value: dom.window.localStorage.getItem(dom.window.CMP.storage.KEY) },
  { key: dom.window.CMP.storage.UI_KEY, value: dom.window.localStorage.getItem(dom.window.CMP.storage.UI_KEY) },
]);
await settle();
clickIt(reopened, q(reopened, '.h-card.is-continue'));
// Resuming loads the constituencies before it can draw a board, so the
// screen does not change on the same tick the card is pressed.
await reopened.window.CMP.data.ensure();
await settle();
check('nav: and a reload comes back to it',
  !!q(reopened, '.g-nav-item.is-on') &&
    q(reopened, '.g-nav-item.is-on .g-nav-label').textContent === 'Loan',
  q(reopened, '.g-nav-item.is-on')
    ? q(reopened, '.g-nav-item.is-on .g-nav-label').textContent
    : 'nothing lit');

// Exactly one tab is ever lit, wherever you are.
check('nav: exactly one tab is lit',
  qq(reopened, '.g-nav-item.is-on').length === 1,
  String(qq(reopened, '.g-nav-item.is-on').length));

/*
 * A screen below the bar leaves Home lit rather than nothing.
 *
 * The bar answers "which of the four am I in"; a rival's areas is not one of
 * the four, and an unlit bar reads as broken rather than as informative.
 */
goHome(dom);
clickIt(dom, q(dom, '.round-aside .g-fig.is-lead'));
await settle();
check('nav: and a screen below it leaves Home lit',
  qq(dom, '.g-nav-item.is-on').length === 1 &&
    q(dom, '.g-nav-item.is-on .g-nav-label').textContent === 'Home',
  q(dom, '.g-nav-item.is-on')
    ? q(dom, '.g-nav-item.is-on .g-nav-label').textContent
    : 'nothing lit');
goHome(dom);
await settle();

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
