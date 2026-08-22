/**
 * Renders a grid of candidate portraits in headless Chrome, so the drawn faces
 * can actually be looked at rather than assumed to work.
 *
 *   node tools/shots-portraits.mjs [outDir]
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
const OUT = process.argv[2] || path.join(os.tmpdir(), 'cmp-portraits');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// portrait.js draws with the shared svg helper, so dom.js comes with it.
const portraitJs = ['js/ui/dom.js', 'js/ui/portrait.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join(String.fromCharCode(10));

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #14110d; font-family: system-ui, sans-serif; color: #f6f1e7; }
  h1 { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: #a89b89;
       margin: 18px 20px 10px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 14px; padding: 0 20px 20px; }
  .cell { text-align: center; }
  .portrait { border-radius: 50%; display: block; margin: 0 auto 5px; }
  .who { font-size: 10px; color: #766c5e; }
</style></head><body>
<h1>Candidate portraits — drawn, never photographed</h1>
<div class="grid" id="grid"></div>
<script>${portraitJs}</script>
<script>
  var grid = document.getElementById('grid');
  CMP.ui.portrait.ids().forEach(function (id, i) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.appendChild(CMP.ui.portrait.render(id, 110, 'candidate ' + (i + 1)));
    var who = document.createElement('div');
    who.className = 'who';
    var d = CMP.ui.portrait.describe(id);
    who.textContent = d.hair + ' / ' + d.beard + ' / ' + d.dress;
    cell.appendChild(who);
    grid.appendChild(cell);
  });
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';

const file = path.join(OUT, 'portraits.png');
await run(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--window-size=1000,760',
  '--screenshot=' + file,
  '--virtual-time-budget=3000',
  url,
], { timeout: 60000 });

server.close();
console.log('wrote ' + file);
