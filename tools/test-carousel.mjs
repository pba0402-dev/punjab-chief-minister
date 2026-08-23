/**
 * The carousels keep their place.
 * ------------------------------------------------------------------
 * jsdom has no layout: every element is zero by zero, nothing scrolls, and a
 * rail that jumped back to the first card would look identical to one that
 * did not. So this suite drives a real headless Chrome, scrolls the rails to
 * the end, picks the last card, and reads the scroll offset back.
 *
 * The bug it exists to catch: choosing a candidate repainted the whole setup
 * screen, which threw the rail away and built a new one — and a new element
 * starts at scrollLeft 0. The selection was right and the view was wrong,
 * which is the worst combination, because it reads as the click having
 * failed.
 *
 *   node tools/test-carousel.mjs
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
function section(title) {
  console.log('\n' + title);
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

/**
 * Run a script inside the real page and hand its answer back.
 *
 * The page is loaded in an iframe at a true phone width so the rails have a
 * viewport narrow enough to actually scroll; the answer comes back through
 * the outer document's title, which --dump-dom will print.
 */
async function inPage(script) {
  const page = '/__probe?' + Buffer.from(script).toString('base64');
  const { stdout } = await run(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--virtual-time-budget=20000',
    '--window-size=470,900', '--dump-dom', BASE + page,
  ], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
  const m = stdout.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) throw new Error('no answer from the page');
  const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('page said: ' + text.slice(0, 300));
  }
}

server.on('request', () => {});

// The probe page: an iframe at 390px, and whatever script was asked for.
const originalHandler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__probe') {
    const script = Buffer.from(req.url.split('?')[1] || '', 'base64').toString('utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;background:#111}' +
      'iframe{width:390px;height:844px;border:0;display:block}</style>' +
      '<iframe id="f" src="/index.html"></iframe>' +
      '<script>' +
      'var f=document.getElementById("f");' +
      'function done(v){document.title=JSON.stringify(v);}' +
      'function fail(e){document.title=JSON.stringify({error:String(e&&e.message||e)});}' +
      'f.onload=function(){var w=f.contentWindow,d=f.contentDocument;' +
      ' setTimeout(function(){try{(' + script + ')(w,d,done,fail);}catch(e){fail(e);}},700);' +
      '};' +
      '<' + '/script>');
    return;
  }
  originalHandler(req, res);
});

/* ------------------------------------------------------------------ */

section('The candidate carousel keeps its place');

/**
 * Open setup, scroll the candidate rail to the end, click the last card.
 *
 * Everything is measured after the click: which card is marked, and whether
 * the rail is still where it was rather than back at the beginning.
 */
const CANDIDATE = `function (w, d, done, fail) {
  w.CMP.data.ensure().then(function () {
    w.CMP.app.goTo('setup');
    setTimeout(function () {
      var rail = d.querySelector('.cd-rail');
      if (!rail) return fail(new Error('no candidate rail'));
      var cards = [].slice.call(rail.querySelectorAll('.cd-card'));
      if (cards.length < 3) return fail(new Error('only ' + cards.length + ' cards'));

      // To the end, the way a thumb would.
      rail.scrollLeft = rail.scrollWidth;
      var atEnd = rail.scrollLeft;

      var last = cards[cards.length - 1];
      var lastId = last.dataset.avatar;
      last.click();

      setTimeout(function () {
        var after = d.querySelector('.cd-rail');
        var onNow = d.querySelector('.cd-card.is-on');
        done({
          cards: cards.length,
          scrollable: atEnd > 0,
          atEnd: atEnd,
          nowAt: after ? after.scrollLeft : -1,
          sameNode: after === rail,
          chosen: onNow ? onNow.dataset.avatar : null,
          wanted: lastId,
          chosenVisible: onNow
            ? (onNow.offsetLeft + onNow.offsetWidth) > after.scrollLeft &&
              onNow.offsetLeft < after.scrollLeft + after.clientWidth
            : false,
          stateWord: onNow ? onNow.querySelector('.cd-card-state').textContent : '',
          detailName: (d.querySelector('.cd-summary-value') || {}).textContent || '',
        });
      }, 500);
    }, 500);
  }, fail);
}`;

const cand = await inPage(CANDIDATE);
if (cand.error) {
  check('the candidate rail could be driven', false, cand.error);
} else {
  check('the rail is long enough to scroll', cand.scrollable,
    'scrollLeft reached ' + cand.atEnd);
  check('picking the last candidate selects the last candidate',
    cand.chosen === cand.wanted, cand.chosen + ' vs ' + cand.wanted);
  check('the rail is the same element it was before the click', cand.sameNode);
  check('and it did NOT jump back to the first candidate', cand.nowAt > 0,
    'scrollLeft ' + cand.atEnd + ' -> ' + cand.nowAt);
  check('the chosen candidate is still on screen', cand.chosenVisible);
  check('and reads as selected', /Selected/i.test(cand.stateWord), cand.stateWord);
  check('the detail below it followed the choice', cand.detailName.length > 0,
    cand.detailName);
}

section('The party carousel keeps its place');

const PARTY = `function (w, d, done, fail) {
  w.CMP.data.ensure().then(function () {
    w.CMP.app.goTo('setup');
    setTimeout(function () {
      // Step one to step two.
      var go = d.querySelector('.screen-setup .btn-start');
      if (!go) return fail(new Error('no continue button'));
      go.click();

      setTimeout(function () {
        var rail = d.querySelector('.pick-rail');
        if (!rail) return fail(new Error('no symbol rail'));
        var cards = [].slice.call(rail.querySelectorAll('.sym-option'));

        rail.scrollLeft = rail.scrollWidth;
        var atEnd = rail.scrollLeft;

        var last = cards[cards.length - 1];
        var lastId = last.dataset.railId;
        last.click();

        setTimeout(function () {
          var after = d.querySelector('.pick-rail');
          var onNow = d.querySelector('.pick-rail .is-on');
          done({
            cards: cards.length,
            scrollable: atEnd > 0,
            atEnd: atEnd,
            nowAt: after ? after.scrollLeft : -1,
            sameNode: after === rail,
            chosen: onNow ? onNow.dataset.railId : null,
            wanted: lastId,
            chosenVisible: onNow
              ? (onNow.offsetLeft + onNow.offsetWidth) > after.scrollLeft &&
                onNow.offsetLeft < after.scrollLeft + after.clientWidth
              : false,
          });
        }, 500);
      }, 600);
    }, 500);
  }, fail);
}`;

const party = await inPage(PARTY);
if (party.error) {
  check('the party rail could be driven', false, party.error);
} else {
  check('the symbol rail is long enough to scroll', party.scrollable,
    'scrollLeft reached ' + party.atEnd);
  check('picking the last symbol selects the last symbol',
    party.chosen === party.wanted, party.chosen + ' vs ' + party.wanted);
  check('the rail is the same element it was before the click', party.sameNode);
  check('and it did NOT jump back to the first symbol', party.nowAt > 0,
    'scrollLeft ' + party.atEnd + ' -> ' + party.nowAt);
  check('the chosen symbol is still on screen', party.chosenVisible);
}

section('Going back does not lose the choice or the place');

const BACK = `function (w, d, done, fail) {
  w.CMP.data.ensure().then(function () {
    w.CMP.app.goTo('setup');
    setTimeout(function () {
      var rail = d.querySelector('.cd-rail');
      var cards = [].slice.call(rail.querySelectorAll('.cd-card'));
      rail.scrollLeft = rail.scrollWidth;
      var last = cards[cards.length - 1];
      var wanted = last.dataset.avatar;
      last.click();

      setTimeout(function () {
        var was = d.querySelector('.cd-rail').scrollLeft;
        // Forward to the party step, then back again.
        d.querySelector('.screen-setup .btn-start').click();
        setTimeout(function () {
          d.querySelector('.screen-setup .back-link').click();
          setTimeout(function () {
            var back = d.querySelector('.cd-rail');
            var onNow = d.querySelector('.cd-card.is-on');
            done({
              wanted: wanted,
              chosen: onNow ? onNow.dataset.avatar : null,
              was: was,
              nowAt: back ? back.scrollLeft : -1,
            });
          }, 500);
        }, 500);
      }, 500);
    }, 500);
  }, fail);
}`;

const back = await inPage(BACK);
if (back.error) {
  check('the back-and-forward walk could be driven', false, back.error);
} else {
  check('the candidate is still selected after going forward and back',
    back.chosen === back.wanted, back.chosen + ' vs ' + back.wanted);
  check('and the rail is still where it was', back.nowAt > 0,
    'was ' + back.was + ', now ' + back.nowAt);
}

/* ------------------------------------------------------------------ */

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
}
server.close();
process.exit(failures.length ? 1 : 0);
