/**
 * Renders simple/ in headless Chrome at desktop and phone widths, flags any
 * horizontal overflow, and saves screenshots so the UI can be looked at.
 *
 * Two constraints shape this:
 *  - Chrome refuses a window narrower than 500px, so phone widths render
 *    inside an iframe of the target width; media queries resolve against the
 *    iframe's own viewport.
 *  - The scene script has to run inside that iframe, so the server serves the
 *    page with the script already appended rather than injecting across
 *    frames (which would be cross-origin).
 *
 *   node tools/shots-simple.mjs [outDir]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'cmp-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const NL = String.fromCharCode(10);

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const SCENES = {
  home: '',
  'home-saved':
    "CMP.storage.save(CMP.state.startElection({partyId:'aap'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'," +
    "budget:100000000}));CMP.app.goTo('home');",
  setup: "CMP.app.goTo('setup');",
  'setup-filled':
    "CMP.app.goTo('setup');" +
    "var cards=document.querySelectorAll('.party-card');cards[0].click();" +
    "var f=document.querySelectorAll('.field-input');" +
    "function type(n,v){n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}" +
    "type(f[0],'Simran Kaur Gill');type(f[1],'Naya Punjab, Sacha Punjab');" +
    "type(document.querySelector('.field-money'),'100000000');",
  election:
    "CMP.app.setGame(CMP.state.startElection({partyId:'aap'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'," +
    "budget:100000000}));CMP.app.goTo('election');",
};

const CASES = [
  { w: 1400, h: 950 },
  { w: 768, h: 900 },
  { w: 390, h: 844 },
  { w: 360, h: 780 },
];

function auditScript(setup) {
  return [
    '<script>window.addEventListener("load",function(){',
    'var NL=String.fromCharCode(10);',
    'try{' + setup + '}catch(e){document.title="SCENE ERROR "+e.message;}',
    'var W=document.documentElement.clientWidth, bad=[];',
    'var all=document.querySelectorAll("*");',
    'for(var i=0;i<all.length;i++){',
    '  var n=all[i]; if(n.id==="audit")continue;',
    '  var r=n.getBoundingClientRect();',
    '  if(r.width>0&&(r.right>W+1||r.left<-1)){',
    '    var c=(typeof n.className==="string")?n.className:"";',
    '    bad.push(n.tagName.toLowerCase()+(c?"."+c.trim().split(/ +/).join("."):"")+" R="+Math.round(r.right));',
    '  }',
    '}',
    'var d=document.createElement("pre"); d.id="audit";',
    'd.style.cssText="position:fixed;left:0;right:0;top:0;z-index:99999;background:#000;'
      + 'color:#0f0;font:11px monospace;padding:5px;margin:0;white-space:pre-wrap";',
    'd.textContent="clientW="+W+"  scrollW="+document.documentElement.scrollWidth',
    '  +"  overflowing="+bad.length+(bad.length?NL+bad.slice(0,8).join(NL):"");',
    'document.body.appendChild(d);',
    '});</script>',
  ].join(NL);
}

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // The page under test, with the scene + audit script appended.
  let m = url.match(/^\/__scene\/([a-z-]+)$/);
  if (m && SCENES[m[1]] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // Served from a nested path, so the page's relative script and css srcs
    // need a base to resolve against or every one of them 404s.
    res.end(
      indexHtml
        .replace('<head>', '<head>' + NL + '    <base href="/" />')
        .replace('</body>', auditScript(SCENES[m[1]]) + '</body>')
    );
    return;
  }

  // A wrapper that frames the page at an exact width, same origin.
  m = url.match(/^\/__wrap\/([a-z-]+)\/(\d+)\/(\d+)$/);
  if (m) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><meta charset="utf-8">' +
        '<style>html,body{margin:0;background:#000}iframe{width:' +
        m[2] + 'px;height:' + m[3] + 'px;border:0;display:block}</style>' +
        '<iframe src="/__scene/' + m[1] + '"></iframe>'
    );
    return;
  }

  const rel = url.replace(/^\/+/, '') || 'index.html';
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
const BASE = 'http://127.0.0.1:' + server.address().port;

for (const scene of Object.keys(SCENES)) {
  for (const c of CASES) {
    const png = path.join(OUT, scene + '-' + c.w + '.png');
    // execFile (async) keeps the event loop free so the server can serve.
    await run(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=6000',
        '--window-size=' + (c.w + 100) + ',' + (c.h + 16),
        '--screenshot=' + png,
        BASE + '/__wrap/' + scene + '/' + c.w + '/' + c.h,
      ],
      { timeout: 90000 }
    ).catch((e) => {
      console.log('  ! ' + scene + '-' + c.w + ': ' + e.message.split(NL)[0]);
    });
    console.log('shot: ' + path.basename(png));
  }
}

server.close();
console.log(NL + 'wrote to ' + OUT);
