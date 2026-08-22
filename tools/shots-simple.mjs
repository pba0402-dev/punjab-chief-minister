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

/** Start a solo campaign and open the game screen. */
function startGame() {
  return "CMP.app.setGame(CMP.state.startElection({partyName:'Unity Punjab Front',partyShort:'UPF'," +
    "candidateName:'Gurpreet Singh',slogan:'Naya Punjab'}));" +
    "CMP.app.goTo('election');";
}

/**
 * Open the game screen on one of its sections.
 *
 * My Areas and Alliances are the two buttons above the map; everything else is
 * under More, because none of it is opened every round.
 */
function sectionScene(label) {
  return startGame() +
    "setTimeout(function(){" +
    "  var name=" + JSON.stringify(label) + ";" +
    "  var s=[].slice.call(document.querySelectorAll('.g-strategy-item'))" +
    "    .filter(function(b){var n=b.querySelector('.g-strategy-label');" +
    "      return n&&n.textContent===name;})[0];" +
    "  if(s){s.click();return;}" +
    "  var more=document.querySelector('.g-more');if(more)more.click();" +
    "  setTimeout(function(){" +
    "    var it=[].slice.call(document.querySelectorAll('.sheet-item'))" +
    "      .filter(function(b){return b.textContent.indexOf(name)===0;})[0];" +
    "    if(it)it.click();" +
    "  },60);" +
    "},80);";
}

/** A game with a few rounds and some spending behind it. */
function playedGame(rounds) {
  return "var g=CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'});" +
    "for(var r=0;r<" + rounds + ";r++){" +
    "  for(var m=0;m<3;m++){" +
    "    CMP.campaign.play(g,m===1?'media':'rally',(r*11+m*7)%117+1," +
    "      {outcome:0.3,consequence:0.9,consequencePick:0.5});" +
    "  }" +
    "  CMP.campaign.endRound(g);CMP.campaign.startNextRound(g);" +
    "}" +
    "CMP.app.setGame(g);CMP.app.goTo('election');";
}

/**
 * Six rounds played and the sixth settling, handed to the shell mid-break
 * rather than raced against the app's own clock.
 */
function roundSix() {
  return "var g=CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'});" +
    "for(var r=0;r<6;r++){" +
    "  for(var m=0;m<3;m++){" +
    "    CMP.campaign.play(g,'rally',(r*11+m*7)%117+1," +
    "      {outcome:0.3,consequence:0.9,consequencePick:0.5});" +
    "  }" +
    "  CMP.campaign.endRound(g);" +
    "  if(r<5)CMP.campaign.startNextRound(g);" +
    "}" +
    "g.intermissionLeft=CMP.campaign.intermissionLeft(g);" +
    "CMP.app.setGame(g);CMP.app.goTo('election');";
}

/** N rounds played, the last of them settling, handed straight to the shell. */
function settledAt(rounds) {
  return "var g=CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'});" +
    "for(var r=0;r<" + rounds + ";r++){" +
    "  for(var m=0;m<3;m++){" +
    "    CMP.campaign.play(g,m===1?'media':'rally',(r*11+m*7)%117+1," +
    "      {outcome:0.3,consequence:0.9,consequencePick:0.5});" +
    "  }" +
    "  CMP.campaign.endRound(g);" +
    "  if(r<" + (rounds - 1) + ")CMP.campaign.startNextRound(g);" +
    "}" +
    "g.intermissionLeft=CMP.campaign.intermissionLeft(g);" +
    "CMP.app.setGame(g);CMP.app.goTo('election');";
}

/** Walk the round-results panel forward by clicking through its stages. */
function throughStages(setup, clicks) {
  var body = "";
  for (var i = clicks; i > 0; i--) {
    body = "setTimeout(function(){" +
      "  var b=[].slice.call(document.querySelectorAll('.round-results button'))" +
      "    .filter(function(x){return /^Continue$|who.s leading|Halfway|round 15 review/i" +
      "      .test(x.textContent);})[0];" +
      "  if(b)b.click();" +
      (body ? "  " + body : "") +
      "},120);";
  }
  return setup + body;
}

const SCENES = {
  home: '',

  /*
   * The home screen with the live counters filled in.
   *
   * `home` above renders it with them empty, because this harness serves
   * static files and the stats call fails — which quietly meant the widest
   * block on that screen was never measured at any width. The deployed site
   * has numbers, and numbers is what has to fit.
   *
   * The stub goes in before home is entered, so the first paint is the one
   * with data in it.
   */
  'home-live':
    "CMP.net.stats=function(){return Promise.resolve({ok:true," +
    "  summary:{players:128,started:12,elections:64,governments:41,coalitions:9," +
    "    byParty:[{party:'p1',share:38},{party:'p2',share:31}," +
    "      {party:'p3',share:19},{party:'p4',share:12}]}," +
    "  leaderboard:[" +
    "    {name:'Simran Kaur Gill',avatar:'a3',score:9600,won:5,played:7,level:4}," +
    "    {name:'Harpreet Singh Dhillon',avatar:'a7',score:8800,won:4,played:6,level:3}," +
    "    {name:'Gurpreet Kaur Sandhu',avatar:'a9',score:7100,won:3,played:5,level:3}]" +
    "});};" +
    "CMP.app.goTo('setup');setTimeout(function(){CMP.app.goTo('home');},40);",

  /*
   * One region on the board, which is what the map is for.
   *
   * Rendered so the audit can see that Majha genuinely replaces the frame
   * rather than Punjab being cropped to it — no Malwa in the corners, and the
   * region fitted without anybody zooming out.
   */
  'map-majha':
    startGame() +
    "setTimeout(function(){" +
    "  var b=[].slice.call(document.querySelectorAll('.map-regions .term-option'))" +
    "    .filter(function(x){return x.textContent==='Majha';})[0];" +
    "  if(b)b.click();" +
    "},120);",

  'map-doaba':
    startGame() +
    "setTimeout(function(){" +
    "  var b=[].slice.call(document.querySelectorAll('.map-regions .term-option'))" +
    "    .filter(function(x){return x.textContent==='Doaba';})[0];" +
    "  if(b)b.click();" +
    "},120);",

  /*
   * The campaign panel in seat mode, over the map.
   *
   * The whole decision on one sheet: where, which seat of the district, how
   * much, and whether to take a risk with it.
   */
  'map-seat-mode':
    startGame() +
    "setTimeout(function(){" +
    "  var c=document.querySelector('.map-cell[data-seat=\"17\"]');" +
    "  if(c)c.dispatchEvent(new MouseEvent('click',{bubbles:true}));" +
    "  setTimeout(function(){" +
    "    var b=[].slice.call(document.querySelectorAll('.cs-target .term-option'))" +
    "      .filter(function(x){return x.textContent==='Seat';})[0];" +
    "    if(b)b.click();" +
    "  },80);" +
    "},140);",

  /*
   * A board with a campaign behind it.
   *
   * Every other map scene is round one on an empty board, which is honest but
   * shows none of the colour the map exists to carry. This plays a dozen
   * rounds first, so the audit sees leaders, contested seats and won ones.
   */
  'map-live':
    "var g=CMP.state.startElection({partyName:'Unity Punjab Front'," +
    "  partyShort:'UPF',candidateName:'Gurpreet Singh',slogan:'Naya Punjab'});" +
    "for(var r=0;r<12;r++){" +
    "  for(var m=0;m<6;m++){" +
    "    CMP.campaign.play(g,'invest',((r*13+m*7)%117)+1," +
    "      {outcome:0.35,consequence:0.99,consequencePick:0.5});" +
    "  }" +
    "  CMP.campaign.endRound(g);" +
    "  CMP.campaign.startNextRound(g);" +
    "}" +
    // The round after the last one is open, so the board is what shows
    // rather than the results sequence — which has its own scenes.
    "g.lastResult=null;" +
    // A district taken outright and a couple of seats besides, so the ticks,
    // the solid district border and the won column are all on screen. Twelve
    // rounds of even spending reaches none of them on its own.
    "var d=CMP.getDistrict('hoshiarpur');" +
    "(d?d.seats:[]).concat([39,40]).forEach(function(n){" +
    "  g.wonSeats[String(n)]={party:g.partyId,round:9,share:82};" +
    "});" +
    "CMP.app.setGame(g);CMP.app.goTo('election');",

  /*
   * The face and symbol pickers, so the audit sees the actual images.
   *
   * Everything else shows a portrait at 28-46px in a corner; this is the one
   * screen where they are the subject.
   */
  'asset-pickers':
    "CMP.app.goTo('setup');" +
    "setTimeout(function(){window.scrollTo(0,400);},400);",

  'home-saved':
    "CMP.storage.save(CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'," +
    "budget:100000000}));CMP.app.goTo('home');",
  setup: "CMP.app.goTo('setup');",
  'setup-filled':
    "CMP.app.goTo('setup');" +
    "function type(n,v){n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}" +
    "var f=document.querySelectorAll('.field-input');" +
    "type(f[0],'Simran Kaur Gill');" +
    "type(document.querySelectorAll('.field-input')[1],'Punjab Development Party');" +
    "setTimeout(function(){" +
    "  var sy=document.querySelectorAll('.sym-option');if(sy[1])sy[1].click();" +
    "  var co=document.querySelectorAll('.col-option');if(co[2])co[2].click();" +
    "},60);",
  election:
    "CMP.app.setGame(CMP.state.startElection({partyName:'Unity Punjab Front',partyShort:'UPF'," +
    "candidateName:'Gurpreet Singh',slogan:'Naya Punjab, Sacha Punjab'}));" +
    "CMP.app.goTo('election');",

  // The drill-down, step by step.
  'flow-areas':
    startGame() +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "},80);",

  'flow-all-seats':
    startGame() +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "  setTimeout(function(){" +
    "    var b=[].slice.call(document.querySelectorAll('button'))" +
    "      .filter(function(x){return /View all 117/.test(x.textContent);})[0];" +
    "    if(b)b.click();" +
    "  },60);" +
    "},80);",

  'flow-seat':
    startGame() +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "  setTimeout(function(){" +
    "    var a=document.querySelector('.area-row');if(a)a.click();" +
    "  },60);" +
    "},80);",

  'flow-campaign':
    startGame() +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "  setTimeout(function(){" +
    "    var a=document.querySelector('.area-row');if(a)a.click();" +
    "    setTimeout(function(){" +
    "      var b=[].slice.call(document.querySelectorAll('button'))" +
    "        .filter(function(x){return /Campaign here/.test(x.textContent);})[0];" +
    "      if(b)b.click();" +
    "    },60);" +
    "  },60);" +
    "},80);",

  'flow-amount':
    startGame() +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "  setTimeout(function(){" +
    "    var a=document.querySelector('.area-row');if(a)a.click();" +
    "    setTimeout(function(){" +
    "      var b=[].slice.call(document.querySelectorAll('button'))" +
    "        .filter(function(x){return /Campaign here/.test(x.textContent);})[0];" +
    "      if(b)b.click();" +
    "      setTimeout(function(){" +
    "        var u=document.querySelectorAll('.campaign-sheet .act-use');" +
    "        if(u[1])u[1].click();" +
    "      },60);" +
    "    },60);" +
    "  },60);" +
    "},80);",

  // The map, which is the home screen, with the campaign panel over it.
  'map-panel':
    startGame() +
    "setTimeout(function(){" +
    "  var cell=document.querySelector('.map-cell[data-seat=\"88\"]');" +
    "  if(cell)cell.dispatchEvent(new MouseEvent('click',{bubbles:true}));" +
    "},120);",

  'sec-money': sectionScene('Money'),
  'sec-loan': sectionScene('Loan'),
  'sec-grants': sectionScene('Grants'),
  'sec-corruption': sectionScene('Corruption'),
  'sec-bribe': sectionScene('Bribe'),
  'sec-seats': sectionScene('All 117'),
  'candidate':
    playedGame(4) +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "},80);",
  'candidate-rival':
    playedGame(4) +
    "setTimeout(function(){" +
    "  var rows=[].slice.call(document.querySelectorAll('.lb-row'));" +
    "  var rival=rows.filter(function(x){return !x.classList.contains('is-you');})[0];" +
    "  if(rival)rival.click();" +
    "},80);",
  'sec-priorities': sectionScene('My Areas'),
  'sec-allies': sectionScene('Alliances'),

  // The money screen with something in the ledger to show.
  'money-spent':
    playedGame(4) +
    "setTimeout(function(){" +
    "  var t=document.querySelectorAll('.g-menu-item');" +
    "  for(var i=0;i<t.length;i++){" +
    "    var n=t[i].querySelector('.g-menu-label');" +
    "    if(n&&n.textContent==='Money')t[i].click();" +
    "  }" +
    "},80);",

  // The candidate summary: the ring, statewide support, top five, closest five.
  'candidate-summary':
    playedGame(4) +
    "setTimeout(function(){" +
    "  var r=document.querySelector('.lb-row.is-you');if(r)r.click();" +
    "},80);",

  // The election history, which is deliberately not on the game screen.
  'history':
    playedGame(6) +
    "setTimeout(function(){" +
    "  var b=document.querySelector('.g-more');if(b)b.click();" +
    "  setTimeout(function(){" +
    "    var it=[].slice.call(document.querySelectorAll('.sheet-item'))" +
    "      .filter(function(x){return /Election history/.test(x.textContent);})[0];" +
    "    if(it)it.click();" +
    "  },60);" +
    "},80);",

  // The profile and the leaderboard.
  profile:
    "CMP.profile.create('Simran Kaur Gill');CMP.app.goTo('profile');",
  leaderboard: "CMP.app.goTo('leaderboard');",

  // A round settling: the scoreboard, seat changes and the position panel.
  // Built straight from the engine and handed to the shell mid-break, rather
  // than raced against the app's own clock.
  'round-results': roundSix(),

  /*
   * The line everybody sees once, before round one.
   *
   * It takes itself away after four seconds, and virtual time burns through
   * four seconds long before the shutter opens — so the scene puts it back.
   */
  opening:
    "CMP.app.setGame(CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill'}));CMP.app.goTo('election');" +
    "setTimeout(function(){" +
    "  var s=document.querySelector('.sheet.is-opening');if(!s)return;" +
    "  var keep=s.cloneNode(true);" +
    "  setInterval(function(){" +
    "    if(!document.querySelector('.sheet.is-opening'))document.body.appendChild(keep);" +
    "  },40);" +
    "},120);",

  // Round results, second screen: the standings, one tap past what changed.
  'round-leading':
    roundSix() +
    "setTimeout(function(){" +
    "  var b=[].slice.call(document.querySelectorAll('button'))" +
    "    .filter(function(x){return /^Continue$|who.s leading/i.test(x.textContent);})[0];" +
    "  if(b)b.click();" +
    "},120);",

  // The loan screen with a debt already running and a payment behind it, which
  // is the state the numbers actually have to survive.
  'loan-owed':
    playedGame(5) +
    "setTimeout(function(){" +
    "  var g=CMP.app.getGame();" +
    "  CMP.campaign.takeLoan(g,CMP.campaign.maxLoan(g));" +
    "  var t=document.querySelectorAll('.g-menu-item');" +
    "  for(var i=0;i<t.length;i++){" +
    "    var n=t[i].querySelector('.g-menu-label');" +
    "    if(n&&n.textContent==='Loan')t[i].click();" +
    "  }" +
    "},80);",

  // Round ten: alliances close, and the screen that says so.
  'milestone-halfway': throughStages(settledAt(10), 2),

  // Round fifteen: the review, and whether anybody is out.
  'milestone-checkpoint': throughStages(settledAt(15), 2),

  'election-count':
    "var g=CMP.state.startElection({partyName:'Punjab Development Party',partyShort:'PDP'," +
    "candidateName:'Simran Kaur Gill',slogan:'Naya Punjab, Sacha Punjab'});" +
    "for(var r=0;r<14;r++){" +
    "  for(var m=0;m<3;m++){" +
    "    CMP.campaign.play(g,'rally',(r*7+m*23)%117+1," +
    "      {outcome:0.3,consequence:0.9,consequencePick:0.5});" +
    "  }" +
    "  CMP.campaign.endRound(g);CMP.campaign.startNextRound(g);" +
    "}" +
    "CMP.app.setGame(g);CMP.app.goTo('election');" +
    "var t=setInterval(function(){" +
    "  if(CMP.app.getScreen()==='result'){" +
    "    clearInterval(t);" +
    "    var b=document.querySelectorAll('button');" +
    "    for(var i=0;i<b.length;i++){" +
    "      if(/Show the result/.test(b[i].textContent))b[i].click();" +
    "    }" +
    "    return;" +
    "  }" +
    "  var gg=CMP.app.getGame();" +
    "  gg.roundEndsAt=Date.now()-1000;gg.nextRoundAt=Date.now()-1000;" +
    "},150);",
};

// The four phone widths the brief names, plus a tablet and a desktop so a
// change that only works small is caught too.
const CASES = [
  { w: 1400, h: 950 },
  { w: 768, h: 900 },
  { w: 430, h: 932 },
  { w: 414, h: 896 },
  { w: 390, h: 844 },
  { w: 375, h: 812 },
  { w: 320, h: 700 },
];

function auditScript(setup) {
  // Every scene but the bare home screen builds a game, and a game needs the
  // board — which the page no longer carries, because the opening screen has
  // no use for it. So the scene waits for it, exactly as the app does.
  const scene = setup
    ? 'CMP.data.ensure().then(function(){' + setup + '});'
    : '';

  return [
    '<script>window.addEventListener("load",function(){',
    'var NL=String.fromCharCode(10);',
    'try{' + scene + '}catch(e){document.title="SCENE ERROR "+e.message;}',
    'var W=document.documentElement.clientWidth, bad=[];',
    'var all=document.querySelectorAll("*");',
    // A deliberate horizontal scroller is not page overflow: its children are
    // meant to run past the edge and be scrolled to. Only flag elements that
    // push the page itself sideways.
    'function inScroller(n){',
    '  for(var p=n.parentElement;p;p=p.parentElement){',
    '    var o=getComputedStyle(p).overflowX;',
    '    if(o==="auto"||o==="scroll")return true;',
    '  }',
    '  return false;',
    '}',
    'for(var i=0;i<all.length;i++){',
    '  var n=all[i]; if(n.id==="audit")continue;',
    '  if(inScroller(n))continue;',
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
    'try{window.top.document.title="AUDIT "+W+" "+bad.length+" "+bad.slice(0,3).join(" | ");}',
    'catch(e){document.title="AUDIT "+W+" "+bad.length;}',
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

const overflows = [];

// `node tools/shots-simple.mjs <outdir> <scene>` renders one scene, which is
// what you want while chasing a single layout down.
const ONLY = process.argv[3] || '';

for (const scene of Object.keys(SCENES)) {
  if (ONLY && scene !== ONLY) continue;
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
    // A second, cheap pass: --dump-dom hands back the title the audit
    // wrote, so a run reports overflow instead of hiding it in an image.
    const dumped = await run(
      CHROME,
      [
        '--headless=new', '--disable-gpu', '--virtual-time-budget=6000',
        '--window-size=' + (c.w + 100) + ',' + (c.h + 16),
        '--dump-dom',
        BASE + '/__wrap/' + scene + '/' + c.w + '/' + c.h,
      ],
      { timeout: 90000, maxBuffer: 64 * 1024 * 1024 }
    ).catch(() => ({ stdout: '' }));

    const seen = (dumped.stdout || '').match(/<title>AUDIT (\d+) (\d+)([^<]*)<\/title>/);
    if (seen && Number(seen[2]) > 0) {
      overflows.push(scene + '@' + c.w + ': ' + seen[2] + seen[3]);
    }
    console.log('shot: ' + path.basename(png) + (seen ? '  overflow ' + seen[2] : ''));
  }
}

server.close();

if (overflows.length) {
  console.log(NL + 'HORIZONTAL OVERFLOW:');
  overflows.forEach((o) => console.log('  ' + o));
  process.exitCode = 1;
} else {
  console.log(NL + 'no horizontal overflow at any width');
}
console.log(NL + 'wrote to ' + OUT);
