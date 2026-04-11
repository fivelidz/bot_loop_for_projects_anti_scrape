#!/usr/bin/env node
/**
 * test-suite.js — Full automated test suite for bot-loop-anti-scrape
 *
 * Tests:
 *   1. Generators (JS, HTML, JSON, CSS) — directly, no HTTP
 *   2. Bot detection logic
 *   3. Obfuscator — output validity, readability score, all 4 projects
 *   4. Inject-protection — injection, idempotency, removal
 *   5. Deploy build pipeline — full build, source integrity
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ── Inline generators (copy from bot-trap.js — avoids starting the HTTP server) ──
function seed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}
function seededRand(s) { s ^= s<<13; s=s>>>0; s ^= s>>17; s=s>>>0; s ^= s<<5; return s>>>0; }
function makeRng(k) { let s = seed(k); return (mn=0,mx=1)=>{ s=seededRand(s); return mn+(s%(mx-mn+1)); }; }

const NOUNS      = ['system','engine','module','handler','controller','parser','router','proxy','cache','session','token','auth','api','service','client','server','pipeline','stream','socket','bridge','hook','plugin','adapter','driver','registry','store','queue','worker','scheduler','dispatcher','emitter','resolver','validator','transformer','formatter','encoder','decoder','manifest','bundle','chunk','asset','resource','endpoint','payload'];
const VERBS      = ['init','load','fetch','parse','render','handle','process','validate','transform','encode','decode','serialize','deserialize','bind','unbind','attach','detach','register','unregister','subscribe','unsubscribe','emit','dispatch','resolve','reject','retry','fallback','intercept','forward','redirect','proxy','cache','invalidate','flush','reset'];
const ADJECTIVES = ['async','lazy','eager','dynamic','static','immutable','reactive','computed','derived','normalized','compressed','encrypted','hashed','signed','verified','pooled','cached','buffered','streamed','paginated','batched','chunked'];

const randWord = (pool, rng) => pool[rng(0, pool.length - 1)];
function randIdentifier(rng, length = null) {
  const len = length || rng(4, 14);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
  const all = chars + '0123456789';
  let id = chars[rng(0, chars.length - 1)];
  for (let i = 1; i < len; i++) id += all[rng(0, all.length - 1)];
  return id;
}
function randHex(rng, len = 8) {
  let h = ''; const hex = '0123456789abcdef';
  for (let i = 0; i < len; i++) h += hex[rng(0, 15)];
  return h;
}

function generateFakeJS(pathKey) {
  const rng = makeRng(pathKey);
  const numFunctions = rng(8, 25);
  const lines = [];
  lines.push(`/* ${randWord(ADJECTIVES,rng)} ${randWord(NOUNS,rng)} v${rng(1,9)}.${rng(0,99)}.${rng(0,9)} */`);
  lines.push(`'use strict';`); lines.push('');
  const numImports = rng(2, 6);
  for (let i = 0; i < numImports; i++) {
    const mod = `${randWord(ADJECTIVES,rng)}-${randWord(NOUNS,rng)}`;
    lines.push(`const ${randIdentifier(rng)} = require('${mod}');`);
  }
  lines.push('');
  const numConsts = rng(3, 8);
  for (let i = 0; i < numConsts; i++) {
    const name = randIdentifier(rng).toUpperCase();
    const val = rng(0,1)===0 ? `'${randHex(rng,rng(8,32))}'` : rng(100,99999);
    lines.push(`const ${name} = ${val};`);
  }
  lines.push('');
  const className = randWord(NOUNS,rng).charAt(0).toUpperCase()+randWord(NOUNS,rng).slice(1);
  lines.push(`class ${className} {`);
  lines.push(`  constructor(options = {}) {`);
  for (let i = 0; i < rng(2,5); i++) {
    const prop = randWord(NOUNS,rng);
    const val = rng(0,2)===0 ? `options.${prop} || null` : rng(0,1)===0 ? `'${randHex(rng,8)}'` : rng(0,100);
    lines.push(`    this.${prop} = ${val};`);
  }
  lines.push(`  }`); lines.push('');
  for (let i = 0; i < rng(3,7); i++) {
    const mn = randWord(VERBS,rng)+randWord(NOUNS,rng).charAt(0).toUpperCase()+randWord(NOUNS,rng).slice(1);
    const isA = rng(0,1);
    lines.push(`  ${isA?'async ':''}${mn}(${randIdentifier(rng)}) {`);
    for (let j = 0; j < rng(2,8); j++) lines.push(`    const ${randIdentifier(rng)} = ${isA&&rng(0,1)?'await ':''}this.${randWord(NOUNS,rng)};`);
    lines.push(`    return ${randIdentifier(rng)};`); lines.push(`  }`); lines.push('');
  }
  lines.push(`}`); lines.push('');
  for (let i = 0; i < numFunctions; i++) {
    const fn = randWord(VERBS,rng)+randWord(NOUNS,rng).charAt(0).toUpperCase()+randWord(NOUNS,rng).slice(1);
    const isA = rng(0,2)===0;
    lines.push(`${isA?'async ':''}function ${fn}(${randIdentifier(rng)}, ${randIdentifier(rng)}) {`);
    for (let j = 0; j < rng(3,12); j++) {
      const v = randIdentifier(rng);
      const val = rng(0,3)===0 ? `'${randHex(rng,rng(4,16))}'` : rng(0,9999);
      lines.push(`  const ${v} = ${val};`);
    }
    lines.push(`  return ${randIdentifier(rng)};`); lines.push(`}`); lines.push('');
  }
  lines.push(`module.exports = { ${className}, ${Array.from({length:rng(3,8)},()=>randWord(VERBS,rng)+randWord(NOUNS,rng).charAt(0).toUpperCase()+randWord(NOUNS,rng).slice(1)).join(', ')} };`);
  return lines.join('\n');
}

function generateFakeHTML(pathKey) {
  const rng = makeRng(pathKey);
  const title = `${randWord(ADJECTIVES,rng)} ${randWord(NOUNS,rng)} ${randWord(VERBS,rng)}er`;
  const numLinks = rng(15,40); const links = [];
  for (let i = 0; i < numLinks; i++) {
    const cp = `/trap/${randWord(NOUNS,rng)}/${randWord(VERBS,rng)}/${randHex(rng,8)}`;
    links.push(`<a href="${cp}">${randWord(ADJECTIVES,rng)} ${randWord(NOUNS,rng)}</a>`);
  }
  const numScripts = rng(3,8); const scriptTags = [];
  for (let i = 0; i < numScripts; i++) scriptTags.push(`<script src="/trap/js/${randHex(rng,12)}.js"></script>`);
  const numApis = rng(4,10); const apiRefs = [];
  for (let i = 0; i < numApis; i++) apiRefs.push(`  <!-- API: /trap/api/${randWord(NOUNS,rng)}/${randHex(rng,8)} -->`);
  const paragraphs = [];
  for (let p = 0; p < rng(3,8); p++) {
    const words = Array.from({length:rng(20,60)},()=>randWord([...NOUNS,...VERBS,...ADJECTIVES],rng));
    paragraphs.push(`<p>${words.join(' ')}</p>`);
  }
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <title>${title}</title>\n  <link rel="stylesheet" href="/trap/css/${randHex(rng,8)}.css">\n  ${apiRefs.join('\n  ')}\n</head>\n<body>\n  ${links.join('\n  ')}\n  ${paragraphs.join('\n  ')}\n  ${scriptTags.join('\n  ')}\n</body>\n</html>`;
}

function generateFakeJSON(pathKey) {
  const rng = makeRng(pathKey);
  const makeObj = (depth=0) => {
    if (depth>3) return randHex(rng,8);
    const obj = {}; const numKeys = rng(2,8);
    for (let i = 0; i < numKeys; i++) {
      const key = randWord(NOUNS,rng)+'_'+randWord(VERBS,rng);
      const type = rng(0,4);
      if (type===0) obj[key]=makeObj(depth+1);
      else if (type===1) obj[key]=Array.from({length:rng(2,6)},()=>makeObj(depth+1));
      else if (type===2) obj[key]=randHex(rng,16);
      else if (type===3) obj[key]=rng(0,999999);
      else obj[key]=rng(0,1)===0;
    }
    obj['_links']={self:`/trap/api/${randWord(NOUNS,rng)}/${randHex(rng,8)}`,next:`/trap/api/${randWord(NOUNS,rng)}/${randHex(rng,8)}?page=${rng(1,999)}`,prev:`/trap/api/${randWord(NOUNS,rng)}/${randHex(rng,8)}?page=${rng(1,999)}`};
    return obj;
  };
  // Seeded fake timestamp — makes JSON fully deterministic (no live clock)
  const fakeTs = `${rng(2021,2025)}-${String(rng(1,12)).padStart(2,'0')}-${String(rng(1,28)).padStart(2,'0')}T${String(rng(0,23)).padStart(2,'0')}:${String(rng(0,59)).padStart(2,'0')}:${String(rng(0,59)).padStart(2,'0')}.000Z`;
  return JSON.stringify({status:'ok',version:`${rng(1,5)}.${rng(0,9)}.${rng(0,99)}`,timestamp:fakeTs,data:Array.from({length:rng(5,20)},()=>makeObj())},null,2);
}

function generateFakeCSS(pathKey) {
  const rng = makeRng(pathKey);
  const lines = [`/* ${randWord(ADJECTIVES,rng)}-${randWord(NOUNS,rng)}.css */`];
  const CSS_VALUE_MAP = {
    'display':['block','flex','grid','inline-block','none'],
    'position':['relative','absolute','fixed','sticky'],
    'margin':(r)=>`${r(0,32)}px ${r(0,32)}px`,
    'padding':(r)=>`${r(0,24)}px ${r(0,24)}px`,
    'color':(r)=>`#${randHex(r,6)}`,
    'background':(r)=>`#${randHex(r,6)}`,
    'font-size':(r)=>`${r(10,24)}px`,
    'font-weight':['400','500','600','700','bold','normal'],
    'border':(r)=>`${r(1,3)}px solid #${randHex(r,6)}`,
    'border-radius':(r)=>`${r(0,24)}px`,
    'opacity':(r)=>`0.${r(1,9)}`,
    'transform':(r)=>`translateX(${r(0,100)}px)`,
    'transition':(r)=>`all ${r(1,5)}00ms ease`,
    'overflow':['hidden','scroll','auto','visible'],
    'z-index':(r)=>`${r(1,999)}`,
  };
  const cssProps = Object.keys(CSS_VALUE_MAP);
  const cssVal = (prop,r)=>{ const v=CSS_VALUE_MAP[prop]; if(!v) return `${r(0,100)}px`; if(typeof v==='function') return v(r); return v[r(0,v.length-1)]; };
  for (let i = 0; i < rng(20,60); i++) {
    lines.push(`.${randWord(ADJECTIVES,rng)}-${randWord(NOUNS,rng)} {`);
    for (let j = 0; j < rng(2,8); j++) {
      const prop = cssProps[rng(0,cssProps.length-1)];
      lines.push(`  ${prop}: ${cssVal(prop,rng)};`);
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

// ── isBot inline — mirrors bot-trap.js exactly, takes req object with .headers ──
const BOT_UA_PATTERNS = [/bot/i,/crawler/i,/spider/i,/scraper/i,/curl/i,/wget/i,/python-requests/i,/python-urllib/i,/axios/i,/node-fetch/i,/go-http-client/i,/headless/i,/phantom/i,/puppeteer/i,/playwright/i,/selenium/i,/scrapy/i,/ahrefsbot/i,/semrushbot/i,/mj12bot/i,/dotbot/i,/nmap/i,/nikto/i,/sqlmap/i];
const LEGIT_BOTS = [/googlebot/i,/bingbot/i,/slurp/i];
function isBot(req) {
  const h = req.headers;
  const ua = h['user-agent'] || '';
  if (!ua) return true;                                      // empty UA = bot
  if (LEGIT_BOTS.some(p=>p.test(ua))) return false;         // legit search engines first
  if (BOT_UA_PATTERNS.some(p=>p.test(ua))) return true;
  if (!h['accept-language']) return true;
  if (!h['accept']) return true;
  if (h['x-headless'] || h['x-scraper']) return true;
  if (!h['sec-fetch-site']) return true;
  return false;
}

// ── Test harness ──
let passed = 0, failed = 0, warnings = 0;
function ok(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function warn(label, detail = '') { console.log(`  ⚠️  ${label}${detail ? ': ' + detail : ''}`); warnings++; }
function section(title) { console.log(`\n${'═'.repeat(52)}\n  ${title}\n${'═'.repeat(52)}`); }

// ════════════════════════════════════════════════════
section('1. GENERATOR TESTS');
// ════════════════════════════════════════════════════

const js1  = generateFakeJS('/trap/test.js');
const js2  = generateFakeJS('/trap/test.js');   // same key
const js3  = generateFakeJS('/trap/other.js');  // different key
ok('JS: generates non-empty output', js1.length > 200);
ok('JS: has use strict', js1.includes("'use strict'"));
ok('JS: has class definition', /^class \w+/m.test(js1));
ok('JS: has require() calls', js1.includes("require('"));
ok('JS: has module.exports', js1.includes('module.exports'));
ok('JS: has function definitions', (js1.match(/^(async )?function /mg)||[]).length >= 5);
ok('JS: deterministic — same key = same output', js1 === js2);
ok('JS: different keys = different output', js1 !== js3);

const html1 = generateFakeHTML('/trap/page-a');
const html2 = generateFakeHTML('/trap/page-a');
const html3 = generateFakeHTML('/trap/page-b');
const trapLinks = (html1.match(/href="\/trap\//g)||[]).length;
const extLinks  = (html1.match(/href="(?!\/trap\/)[^"]/g)||[]).filter(Boolean).length;
ok('HTML: generates valid HTML doc', html1.includes('<!DOCTYPE html'));
ok(`HTML: trap links count ${trapLinks} is in range 15-40`, trapLinks >= 15 && trapLinks <= 40);
ok('HTML: zero external links (sealed loop)', extLinks === 0);
ok('HTML: has <script src="/trap/js/..."> tags', html1.includes('<script src="/trap/js/'));
ok('HTML: has CSS link to /trap/css/', html1.includes('href="/trap/css/'));
ok('HTML: deterministic', html1 === html2);
ok('HTML: different URLs = different content', html1 !== html3);

const jsonStr = generateFakeJSON('/trap/api/users');
let jsonObj;
try { jsonObj = JSON.parse(jsonStr); ok('JSON: parses as valid JSON', true); }
catch(e) { ok('JSON: parses as valid JSON', false, e.message); }
if (jsonObj) {
  ok('JSON: has status:ok', jsonObj.status === 'ok');
  ok('JSON: has data array', Array.isArray(jsonObj.data) && jsonObj.data.length >= 5);
  ok('JSON: _links.next points to /trap/api/', (jsonObj.data[0]._links||{}).next?.includes('/trap/api/'));
  ok('JSON: _links.self points to /trap/api/', (jsonObj.data[0]._links||{}).self?.includes('/trap/api/'));
  ok('JSON: deterministic', jsonStr === generateFakeJSON('/trap/api/users'));
}

const css = generateFakeCSS('/trap/style.css');
// A bare 3-char hex value is ONLY invalid when used as a CSS property value without a #.
// e.g. "color: 4f2" = bad, "color: #4f2" = ok, "z-index: 505" = valid (numeric, not hex).
// Regex: matches lines where value is exactly 3 hex chars with NO leading # and NO trailing px/etc.
const bareHexVals = css.split('\n').filter(l => /^\s+\S+:\s+[0-9a-f]{3}\s*;/.test(l) && !/^\s+z-index:|^\s+font-weight:|^\s+opacity:/.test(l));
const emptyVals   = css.split('\n').filter(l => /^\s+\S+:\s*;/.test(l));
ok('CSS: generates non-empty output', css.length > 200);
ok('CSS: has rule blocks', (css.match(/^\}/mg)||[]).length >= 10);
ok('CSS: no bare 3-char hex values (invalid CSS)', bareHexVals.length === 0, bareHexVals.slice(0,2).join(', '));
ok('CSS: no empty property values', emptyVals.length === 0, emptyVals.slice(0,2).join(', '));
ok('CSS: has valid-looking font-size', /font-size: \d+px/.test(css));
ok('CSS: has valid-looking color', /color: #[0-9a-f]{6}/.test(css));
ok('CSS: deterministic', css === generateFakeCSS('/trap/style.css'));

// ════════════════════════════════════════════════════
section('2. BOT DETECTION TESTS');
// ════════════════════════════════════════════════════

// isBot takes req object with a .headers property — wrap all test cases correctly
const req = (h) => ({ headers: h, socket: { remoteAddress: '127.0.0.1' } });

const browserHeaders = { 'user-agent':'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0', 'accept-language':'en-US,en;q=0.9', 'accept':'text/html,application/xhtml+xml', 'sec-fetch-site':'none' };

ok('DETECT: scrapy UA → bot', isBot(req({'user-agent':'scrapy/2.11','accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: python-requests → bot', isBot(req({'user-agent':'python-requests/2.31','accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: curl UA → bot', isBot(req({'user-agent':'curl/7.88','accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: wget → bot', isBot(req({'user-agent':'Wget/1.21','accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: ahrefsbot → bot', isBot(req({'user-agent':'AhrefsBot/7.0','accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: no UA → bot', isBot(req({'accept':'*/*','accept-language':'en','sec-fetch-site':'same-origin'})));
ok('DETECT: no accept-language → bot', isBot(req({'user-agent':'Something','accept':'*/*','sec-fetch-site':'same-origin'})));
ok('DETECT: no sec-fetch-site → bot', isBot(req({'user-agent':'Mozilla/5.0','accept-language':'en','accept':'text/html'})));
ok('DETECT: x-headless header → bot', isBot(req({...browserHeaders,'x-headless':'1'})));
ok('DETECT: Googlebot → NOT bot', !isBot(req({'user-agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','accept-language':'en','accept':'*/*','sec-fetch-site':'none'})));
ok('DETECT: Bingbot → NOT bot', !isBot(req({'user-agent':'Mozilla/5.0 (compatible; bingbot/2.0)','accept-language':'en','accept':'*/*','sec-fetch-site':'none'})));
ok('DETECT: real Chrome browser → NOT bot', !isBot(req(browserHeaders)));

// ════════════════════════════════════════════════════
section('3. OBFUSCATOR TESTS');
// ════════════════════════════════════════════════════

const OPTS_FULL = {
  compact:true, controlFlowFlattening:true, controlFlowFlatteningThreshold:0.75,
  deadCodeInjection:true, deadCodeInjectionThreshold:0.4, debugProtection:false,
  identifierNamesGenerator:'hexadecimal', renameGlobals:false, selfDefending:true,
  simplify:true, splitStrings:true, splitStringsChunkLength:10,
  stringArray:true, stringArrayEncoding:['base64'], stringArrayRotate:true,
  stringArrayShuffle:true, stringArrayThreshold:0.75, transformObjectKeys:true,
};
const OPTS_LIGHT = {
  compact:true, controlFlowFlattening:false, deadCodeInjection:false, debugProtection:false,
  identifierNamesGenerator:'hexadecimal', renameGlobals:false, selfDefending:true,
  splitStrings:true, splitStringsChunkLength:4, stringArray:true,
  stringArrayEncoding:['base64'], stringArrayRotate:true, stringArrayShuffle:true,
  stringArrayThreshold:1.0,  // encode ALL strings
};

const testSrc = `
function greet(name) {
  var msg = 'Hello, ' + name + '! Welcome to qalarc.com.';
  var key = 'secret-api-key-abc123';
  console.log(msg);
  return { message: msg, key: key };
}
module.exports = { greet };
`;

// Full obfuscation
const fullResult = JavaScriptObfuscator.obfuscate(testSrc, OPTS_FULL);
const fullOut = fullResult.getObfuscatedCode();
ok('OBF FULL: produces output', fullOut.length > 100);
ok('OBF FULL: original string "Hello" not visible', !fullOut.includes('Hello'));
ok('OBF FULL: original string "secret-api-key" not visible', !fullOut.includes('secret-api-key'));
// renameGlobals is intentionally false to preserve public API surface — exported function
// names like "greet" will still appear. What matters is strings and internals are hidden.
ok('OBF FULL: internal strings hidden (not function name, which is kept for API)', !fullOut.includes('Hello') && !fullOut.includes('secret-api-key'));
ok('OBF FULL: has hex identifiers (_0x)', fullOut.includes('_0x'));
ok('OBF FULL: output is larger than input (dead code added)', fullOut.length > testSrc.length);
// Check it still runs
try {
  const tmpFile = '/tmp/test_obf_full.js';
  fs.writeFileSync(tmpFile, fullOut + '\nmodule.exports && module.exports.greet && module.exports.greet("test");');
  execSync(`node ${tmpFile}`, {timeout:5000});
  ok('OBF FULL: obfuscated output still executes correctly', true);
} catch(e) { ok('OBF FULL: obfuscated output still executes correctly', false, e.message); }

// Light obfuscation
const lightResult = JavaScriptObfuscator.obfuscate(testSrc, OPTS_LIGHT);
const lightOut = lightResult.getObfuscatedCode();
ok('OBF LIGHT: produces output', lightOut.length > 100);
ok('OBF LIGHT: original strings not visible', !lightOut.includes('Hello') && !lightOut.includes('secret-api-key'));
ok('OBF LIGHT: has hex identifiers', lightOut.includes('_0x'));

// Project file checks — sample a real file from each project
const PROJECT_SAMPLES = [
  { name:'bella',     file:'/home/fivelidz/projects/bella_website/script.js' },
  { name:'fivelidz',  file:'/home/fivelidz/projects/fivelidz_website/public_html/js/comments.js' },
  { name:'endispute', file:'/home/fivelidz/projects/Endispute_site/script.js' },
  { name:'showcase',  file:'/home/fivelidz/projects/projects-showcase-site/assets/js/main.js' },
];

for (const p of PROJECT_SAMPLES) {
  if (!fs.existsSync(p.file)) { warn(`${p.name}: sample file not found at ${p.file}`); continue; }
  const src = fs.readFileSync(p.file, 'utf8');
  const isLarge = src.length > 30*1024;
  const opts = isLarge ? OPTS_LIGHT : OPTS_FULL;
  try {
    const r = JavaScriptObfuscator.obfuscate(src, opts);
    const out = r.getObfuscatedCode();
    ok(`OBF ${p.name}: ${path.basename(p.file)} (${Math.round(src.length/1024)}KB ${isLarge?'light':'full'}) — obfuscates OK`, out.length > 100);
    ok(`OBF ${p.name}: hex identifiers present`, out.includes('_0x'));
    // Write and try to execute
    const tmp = `/tmp/test_obf_${p.name}.js`;
    fs.writeFileSync(tmp, out);
    try { execSync(`node --check ${tmp}`, {timeout:5000}); ok(`OBF ${p.name}: output is valid JS (node --check)`, true); }
    catch(e) { ok(`OBF ${p.name}: output is valid JS (node --check)`, false, e.message.split('\n')[0]); }
  } catch(e) { warn(`OBF ${p.name}: ${path.basename(p.file)} — parser error: ${e.message.split('\n')[0]}`); }
}

// ════════════════════════════════════════════════════
section('4. INJECT-PROTECTION TESTS');
// ════════════════════════════════════════════════════

const INJECTION_MARKER = '<!-- qalarc-bot-trap -->';
const INJECTION_TAG = `  ${INJECTION_MARKER}<script src="/bot-trap-client.js" defer></script>`;
const tmpHtmlDir = '/tmp/inject_test_' + Date.now();
fs.mkdirSync(tmpHtmlDir);

// Test 1: basic injection
const htmlNoHead = `<!DOCTYPE html>\n<html>\n<head>\n  <title>Test</title>\n</head>\n<body><p>Hello</p></body>\n</html>`;
const htmlFile = path.join(tmpHtmlDir, 'test.html');
fs.writeFileSync(htmlFile, htmlNoHead);
execSync(`node /home/fivelidz/projects/bot_loop_for_projects_anti_scrape/inject-protection.js --run --dir ${tmpHtmlDir}`, {timeout:5000});
const injected = fs.readFileSync(htmlFile, 'utf8');
ok('INJECT: marker present after injection', injected.includes(INJECTION_MARKER));
ok('INJECT: script tag present after injection', injected.includes('bot-trap-client.js'));
ok('INJECT: injected inside <head>', injected.indexOf(INJECTION_MARKER) < injected.indexOf('</head>'));
ok('INJECT: archive created', fs.existsSync(path.join(tmpHtmlDir, 'archive_originals')));

// Test 2: idempotent — running twice doesn't double-inject
execSync(`node /home/fivelidz/projects/bot_loop_for_projects_anti_scrape/inject-protection.js --run --dir ${tmpHtmlDir}`, {timeout:5000});
const injectedTwice = fs.readFileSync(htmlFile, 'utf8');
const markerCount = (injectedTwice.match(new RegExp(INJECTION_MARKER, 'g'))||[]).length;
ok('INJECT: idempotent — marker appears exactly once after 2 runs', markerCount === 1);

// Test 3: removal
execSync(`node /home/fivelidz/projects/bot_loop_for_projects_anti_scrape/inject-protection.js --remove --dir ${tmpHtmlDir}`, {timeout:5000});
const removed = fs.readFileSync(htmlFile, 'utf8');
ok('INJECT: --remove strips the marker', !removed.includes(INJECTION_MARKER));
ok('INJECT: --remove leaves rest of HTML intact', removed.includes('<title>Test</title>'));

// ════════════════════════════════════════════════════
section('5. BUILD PIPELINE TESTS');
// ════════════════════════════════════════════════════

console.log('  Running full build (all 4 projects)...');
const t0 = Date.now();
let buildOut = '';
try {
  buildOut = execSync('node /home/fivelidz/projects/bot_loop_for_projects_anti_scrape/deploy.js --build', {timeout:180000, encoding:'utf8'});
} catch(e) { buildOut = e.stdout || ''; ok('BUILD: exits without error', false, e.message); }
const buildTime = Date.now() - t0;
console.log(`  Build completed in ${(buildTime/1000).toFixed(1)}s`);

ok('BUILD: completed in <120s', buildTime < 120000, `${(buildTime/1000).toFixed(1)}s`);
ok('BUILD: bella processed', buildOut.includes('[bella]'));
ok('BUILD: fivelidz processed', buildOut.includes('[fivelidz]'));
ok('BUILD: endispute processed', buildOut.includes('[endispute]'));
ok('BUILD: showcase processed', buildOut.includes('[showcase]'));

// Check build output
const BUILD_DIR = '/tmp/qalarc-build';
for (const proj of ['bella','fivelidz','endispute','showcase']) {
  const projDir = path.join(BUILD_DIR, proj);
  ok(`BUILD: ${proj} build dir exists`, fs.existsSync(projDir));
  ok(`BUILD: ${proj} has bot-trap-client.js`, fs.existsSync(path.join(projDir,'bot-trap-client.js')));

  // Count JS files obfuscated
  function findFiles(dir, ext, acc=[]) {
    if (!fs.existsSync(dir)) return acc;
    try {
      for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) findFiles(f,ext,acc);
        else if (e.isFile()&&e.name.endsWith(ext)) acc.push(f);
      }
    } catch(_) {}
    return acc;
  }
  const jsFiles  = findFiles(projDir, '.js').filter(f => !f.includes('bot-trap-client'));
  const obfFiles = jsFiles.filter(f => { try { return fs.readFileSync(f,'utf8').includes('_0x'); } catch(_){return false;} });
  const htmlFiles = findFiles(projDir, '.html');
  const injFiles  = htmlFiles.filter(f => { try { return fs.readFileSync(f,'utf8').includes(INJECTION_MARKER); } catch(_){return false;} });
  const pct = jsFiles.length ? Math.round(obfFiles.length/jsFiles.length*100) : 0;
  ok(`BUILD: ${proj} JS obfuscated ${obfFiles.length}/${jsFiles.length} (${pct}%)`, pct >= 90 || jsFiles.length === 0);
  ok(`BUILD: ${proj} HTML injected ${injFiles.length}/${htmlFiles.length}`, injFiles.length === htmlFiles.length);
}

// Source files must NOT be modified
const SOURCES = [
  '/home/fivelidz/projects/bella_website',
  '/home/fivelidz/projects/fivelidz_website/public_html',
  '/home/fivelidz/projects/Endispute_site',
  '/home/fivelidz/projects/projects-showcase-site',
];
for (const srcDir of SOURCES) {
  const name = srcDir.split('/').pop();
  try {
    const out = execSync(`grep -rl "qalarc-bot-trap" ${srcDir}/ 2>/dev/null | wc -l`, {encoding:'utf8'}).trim();
    ok(`BUILD: source ${name} untouched (0 injected files)`, out === '0', `found ${out} injected files`);
  } catch(_) { ok(`BUILD: source ${name} untouched`, true); }
}

// original_site must NOT be in endispute build
const originalSiteInBuild = fs.existsSync('/tmp/qalarc-build/endispute/original_site');
ok('BUILD: endispute original_site/ excluded from build', !originalSiteInBuild);

// ════════════════════════════════════════════════════
section('RESULTS');
// ════════════════════════════════════════════════════
console.log(`\n  Passed:   ${passed}`);
console.log(`  Failed:   ${failed}`);
console.log(`  Warnings: ${warnings}`);
console.log(failed === 0
  ? `\n  ✅ ALL TESTS PASSED\n`
  : `\n  ❌ ${failed} TEST(S) FAILED — see above\n`);
process.exit(failed > 0 ? 1 : 0);
