"""One-off: the shot tool reports horizontal overflow to the terminal."""
import io
import sys

p = 'tools/shots-simple.mjs'
s = io.open(p, encoding='utf-8').read()

# 1. The audit writes its verdict into the wrapper page's title as well as
#    drawing it, so a run can be read without opening 161 images.
old = """    'document.body.appendChild(d);',"""
new = """    'document.body.appendChild(d);',
    'try{window.top.document.title="AUDIT "+W+" "+bad.length+" "+bad.slice(0,3).join(" | ");}',
    'catch(e){document.title="AUDIT "+W+" "+bad.length;}',"""
if old not in s:
    print('NOT FOUND: appendChild')
    sys.exit(1)
s = s.replace(old, new, 1)

# 2. Collect them.
old = """for (const name of Object.keys(SCENES)) {
  for (const c of CASES) {"""
new = """const overflows = [];

for (const name of Object.keys(SCENES)) {
  for (const c of CASES) {"""
if old not in s:
    print('NOT FOUND: the shot loop')
    sys.exit(1)
s = s.replace(old, new, 1)

# 3. Read the title back with a second, cheap pass.
old = "    console.log('shot: ' + path.basename(shot));"
new = (
    "    const dumped = await run(CHROME, [\n"
    "      '--headless=new', '--disable-gpu', '--virtual-time-budget=6000',\n"
    "      '--window-size=' + Math.max(520, c.w) + ',' + c.h,\n"
    "      '--dump-dom',\n"
    "      'file:///' + file.replace(/[\\\\\\\\]/g, '/'),\n"
    "    ], { maxBuffer: 64 * 1024 * 1024 });\n"
    "    const m = (dumped.stdout || '').match(/<title>AUDIT (\\d+) (\\d+)([^<]*)<\\/title>/);\n"
    "    if (m && Number(m[2]) > 0) overflows.push(name + '@' + c.w + ': ' + m[2] + m[3]);\n"
    "    console.log('shot: ' + path.basename(shot) + (m ? '  overflow ' + m[2] : ''));"
)
if old not in s:
    print('NOT FOUND: the shot log line')
    sys.exit(1)
s = s.replace(old, new, 1)

# 4. Report at the end, and fail the run if anything overflowed.
old = "console.log(NL + 'wrote to ' + OUT);"
new = (
    "console.log(NL + 'wrote to ' + OUT);\n"
    "if (overflows.length) {\n"
    "  console.log(NL + 'HORIZONTAL OVERFLOW:');\n"
    "  overflows.forEach((o) => console.log('  ' + o));\n"
    "  process.exitCode = 1;\n"
    "} else {\n"
    "  console.log('no horizontal overflow at any width');\n"
    "}"
)
if old not in s:
    print('NOT FOUND: the closing log')
    sys.exit(1)
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('shots-simple.mjs: overflow reported to the terminal')
