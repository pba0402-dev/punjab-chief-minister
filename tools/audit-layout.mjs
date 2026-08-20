/**
 * Layout audit (dev only).
 * ------------------------------------------------------------------
 * Renders the built game at several viewport widths in headless Chrome and
 * reports any element whose box spills past the viewport. Horizontal overflow
 * is the failure mode that quietly breaks a mobile layout, and it is invisible
 * in jsdom, which has no layout engine.
 *
 * Headless Chrome refuses to open a window narrower than 500px, so narrow
 * widths are tested by hosting the game in an iframe of the target width:
 * media queries inside an iframe resolve against the iframe's own viewport.
 *
 *   node tools/audit-layout.mjs [--shots]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = path.join(os.tmpdir(), 'punjab-audit');
const NL = String.fromCharCode(10);

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const bundle = fs.readFileSync(path.join(ROOT, 'dist', 'punjab-cm.html'), 'utf8');

const SCREENS = {
  setup: '',
  game:
    "PG.__app.loadGame(PG.engine.newGame({stateId:'punjab',partyId:'ppp'," +
    "candidateName:'Harleen Kaur Sandhu',strategyId:'grassroots'," +
    "difficulty:'normal',seed:'audit'}));PG.__app.selectSeat(73);",
  results:
    "var g=PG.engine.newGame({stateId:'punjab',partyId:'ppp',candidateName:'Harleen Kaur Sandhu'," +
    "strategyId:'grassroots',difficulty:'easy',seed:'audit-r'});" +
    'for(var t=0;t<10;t++){PG.engine.endTurn(g);}PG.engine.runElection(g);' +
    'PG.__app.loadGame(g);PG.__app.showResults();',
};

const CASES = [
  { w: 1600, h: 1000 },
  { w: 1180, h: 900 },
  { w: 900, h: 900 },
  { w: 768, h: 900 },
  { w: 600, h: 900 },
  { w: 412, h: 860 },
  { w: 360, h: 780 },
];

const SHOW_REPORT = !process.argv.includes('--shots');

function auditScript(setup) {
  return [
    '<script>window.addEventListener("load",function(){',
    'var NL=String.fromCharCode(10);',
    'var out=[];',
    'try{' + setup + '}catch(e){out.push("SETUP ERROR: "+e.message);}',
    'var W=document.documentElement.clientWidth;',
    'var bad=[];',
    'var all=document.querySelectorAll("*");',
    'for(var i=0;i<all.length;i++){',
    '  var n=all[i];',
    '  if(n.id==="audit")continue;',
    '  var r=n.getBoundingClientRect();',
    '  if(r.width>0&&(r.right>W+1||r.left<-1)){',
    '    var cls=(typeof n.className==="string")?n.className:"";',
    '    bad.push(n.tagName.toLowerCase()+(cls?"."+cls.trim().split(/ +/).join("."):"")',
    '      +" w="+Math.round(r.width)+" L="+Math.round(r.left)+" R="+Math.round(r.right));',
    '  }',
    '}',
    'out.push("clientW="+W+"  docScrollW="+document.documentElement.scrollWidth',
    '  +"  overflowing="+bad.length);',
    'for(var j=0;j<bad.length&&j<16;j++){out.push("  "+bad[j]);}',
    SHOW_REPORT
      ? [
          'var d=document.createElement("pre");',
          'd.id="audit";',
          'd.style.cssText="position:fixed;left:0;right:0;top:0;z-index:99999;background:#000;'
            + 'color:#0f0;font:11px monospace;padding:6px;margin:0;white-space:pre-wrap";',
          'd.textContent=out.join(NL);',
          'document.body.appendChild(d);',
        ].join(NL)
      : '',
    '});</script>',
  ].join(NL);
}

const results = [];
for (const [screen, setup] of Object.entries(SCREENS)) {
  for (const c of CASES) {
    const inner = path.join(TMP, screen + '-' + c.w + '-inner.html');
    fs.writeFileSync(inner, bundle.replace('</body>', auditScript(setup) + '</body>'));

    // Chrome's minimum window is 500px, so anything narrower goes in an iframe.
    let target = inner;
    let win = { w: c.w, h: c.h };
    if (c.w < 520) {
      const host = path.join(TMP, screen + '-' + c.w + '-host.html');
      fs.writeFileSync(
        host,
        '<!doctype html><meta charset="utf-8">' +
          '<style>html,body{margin:0;background:#000}' +
          'iframe{width:' + c.w + 'px;height:' + c.h + 'px;border:0;display:block}</style>' +
          '<iframe src="' + path.basename(inner) + '"></iframe>'
      );
      target = host;
      win = { w: c.w + 120, h: c.h + 20 };
    }

    const png = path.join(TMP, screen + '-' + c.w + '.png');
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=5000',
        '--window-size=' + win.w + ',' + win.h,
        '--screenshot=' + png,
        'file:///' + target.replace(/\\/g, '/'),
      ],
      { stdio: 'pipe', timeout: 90000 }
    );
    results.push(screen + '-' + c.w);
  }
}

console.log('rendered: ' + results.join(', '));
console.log('output: ' + TMP);
