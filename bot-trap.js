/**
 * bot-trap.js — Algorithmic Generative Infinite Loop for Scrapers
 * 
 * Drop this file on your server. It serves an endless stream of
 * algorithmically-generated fake pages/endpoints that:
 * 
 *   1. Detect bots via user-agent, header analysis, and behavioural signals
 *   2. Feed them infinite procedurally-generated "content" (fake JS, fake HTML,
 *      fake JSON, fake API responses) that loops back on itself
 *   3. Each link/resource in the fake pages points back into the trap
 *   4. Scraper bandwidth and CPU gets consumed doing nothing useful
 *   5. Real users are transparently passed through
 * 
 * ──────────────────────────────────────────────────────────────────────────
 * SERVER DEPLOYMENT (Node.js standalone):
 *   node bot-trap.js                  # runs on port 4444
 *   PORT=8888 node bot-trap.js        # custom port
 * 
 * NGINX INTEGRATION (route bots to this service):
 *   See README.md for nginx map + proxy_pass config
 * 
 * EMBED IN HTML (client-side honeypot, optional add-on):
 *   See bot-trap-client.js for the browser-side version
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * ⚠️  DEPLOYMENT NOTE — qalarc.com uses Cloudflare Pages, NOT nginx.
 *     This Node.js server cannot run directly on Cloudflare Pages.
 *     For CF Pages deployment use: functions/_middleware.js (see below).
 *     This file is still useful for:
 *       - Any traditional VPS/nginx deployments (fivelidz.com, bella_website etc.)
 *       - Local testing of the generative engine before deploying to CF
 *       - The deploy.js pipeline targeting non-CF servers
 * 
 * ⚠️  DESIGN ISSUE — `crypto` is imported but never used.
 *     The seed/hash function uses a manual FNV-1a implementation instead.
 *     Either use crypto.createHash('sha256') for the seed (more collision-resistant)
 *     or remove the import. Currently just dead weight.
 * 
 * ⚠️  DESIGN ISSUE — The isBot() function allows ALL requests through
 *     to the /trap/ zone even when NOT a bot (see line: `const inTrap = pathname.startsWith('/trap/')`).
 *     This means if a real user somehow lands on /trap/anything they get fake content.
 *     In practice fine since no real links point there, but worth noting.
 * 
 * ⚠️  DESIGN ISSUE — No rate limiting on the trap itself.
 *     A determined attacker could hammer /trap/ to generate load on YOUR server.
 *     The delay (100-800ms) helps but doesn't cap concurrent connections.
 *     Mitigation: set maxConnections in the http.createServer options, or use nginx
 *     limit_conn upstream of this process.
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

const http = require('http');
const crypto = require('crypto'); // ⚠️ imported but unused — seed uses manual FNV-1a. Either use or remove.
const url = require('url');

const PORT = process.env.PORT || 4444;

// ─── BOT DETECTION ──────────────────────────────────────────────────────────

const BOT_UA_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
  /python-requests/i, /python-urllib/i, /axios/i, /node-fetch/i,
  /go-http-client/i, /java\//i, /jakarta/i, /okhttp/i,
  /headless/i, /phantom/i, /puppeteer/i, /playwright/i, /selenium/i,
  /scrapy/i, /httrack/i, /webripper/i, /getright/i, /teleport/i,
  /nutch/i, /heritrix/i, /archiver/i, /archive\.org/i,
  /mj12bot/i, /ahrefsbot/i, /semrushbot/i, /dotbot/i, /rogerbot/i,
  /blexbot/i, /yandexbot/i, /baiduspider/i, /duckduckbot/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /dataprovider/i, /sistrix/i, /seokicks/i, /majestic/i,
  /nmap/i, /nikto/i, /sqlmap/i, /masscan/i,
  // ⚠️ MISSING: major AI training crawlers added since original writing:
  // GPTBot (OpenAI), ClaudeBot (Anthropic), CCBot (Common Crawl used for training),
  // Bytespider (ByteDance/TikTok), PerplexityBot, cohere-ai, Diffbot.
  // These are the highest-priority ones for IP protection — add them:
  // /GPTBot/i, /ClaudeBot/i, /anthropic-ai/i, /CCBot/i,
  // /Bytespider/i, /PerplexityBot/i, /cohere-ai/i, /Diffbot/i,
];

const LEGITIMATE_BOTS = [
  /googlebot/i, /bingbot/i, /slurp/i,  // allow major search engines through
  // ℹ️  DuckDuckBot is in BOT_UA_PATTERNS above but arguably legitimate —
  //    decide if you want DDG to index your site. If yes, add /duckduckbot/i here
  //    and remove it from BOT_UA_PATTERNS.
];

function isBot(req) {
  const ua = req.headers['user-agent'] || '';

  // No user-agent at all = almost certainly automated (every real browser sends one)
  if (!ua) return true;

  // Let legitimate search engines through before any other checks
  if (LEGITIMATE_BOTS.some(p => p.test(ua))) return false;

  // Known bad UAs
  if (BOT_UA_PATTERNS.some(p => p.test(ua))) return true;

  // Missing common browser headers = likely automated
  if (!req.headers['accept-language']) return true;
  if (!req.headers['accept']) return true;

  // Explicit headless/scraper self-identification
  if (req.headers['x-headless'] || req.headers['x-scraper']) return true;

  // Missing sec-fetch-site = not a modern browser making a navigation request.
  // accept-language is guaranteed present at this point (checked above).
  if (!req.headers['sec-fetch-site']) return true;

  return false;
}

// ─── GENERATIVE ENGINE ───────────────────────────────────────────────────────

// Deterministic-but-endless seed system: same seed → same "page", but seeds
// are derived from the request path so the loop is internally consistent.

function seed(str) {
  // FNV-1a 32-bit hash — fast, low collision for short strings like URL paths.
  // Good enough for seeding the trap generator. Not cryptographic.
  // ℹ️  Alternative: use crypto.createHash('sha256').update(str).digest('hex')
  //    then parseInt(hash.slice(0,8), 16) for a more uniform seed distribution.
  //    Current FNV-1a is fine for this use case though.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function seededRand(s) {
  // Xorshift32 PRNG — fast and sufficient for procedural content generation.
  // ⚠️  Not cryptographically secure — fine here since we just need varied fake content,
  //    NOT security randomness. Do NOT use this for tokens, session IDs, etc.
  s ^= s << 13; s = s >>> 0;
  s ^= s >> 17; s = s >>> 0;
  s ^= s << 5;  s = s >>> 0;
  return s;
}

function makeRng(seedStr) {
  let s = seed(seedStr);
  return function(min = 0, max = 1) {
    s = seededRand(s);
    return min + (s % (max - min + 1));
  };
}

// Word pools for generating convincing fake content
const NOUNS = [
  'system','engine','module','handler','controller','parser','router','proxy',
  'cache','session','token','auth','api','service','client','server',
  'pipeline','stream','socket','bridge','hook','plugin','adapter','driver',
  'registry','store','queue','worker','scheduler','dispatcher','emitter',
  'resolver','validator','transformer','formatter','encoder','decoder',
  'manifest','bundle','chunk','asset','resource','endpoint','payload',
];

const VERBS = [
  'init','load','fetch','parse','render','handle','process','validate',
  'transform','encode','decode','serialize','deserialize','bind','unbind',
  'attach','detach','register','unregister','subscribe','unsubscribe',
  'emit','dispatch','resolve','reject','retry','fallback','intercept',
  'forward','redirect','proxy','cache','invalidate','flush','reset',
];

const ADJECTIVES = [
  'async','lazy','eager','dynamic','static','immutable','reactive','computed',
  'derived','normalized','compressed','encrypted','hashed','signed','verified',
  'pooled','cached','buffered','streamed','paginated','batched','chunked',
];

function randWord(pool, rng) {
  return pool[rng(0, pool.length - 1)];
}

function randIdentifier(rng, length = null) {
  const len = length || rng(4, 14);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
  const digits = '0123456789';
  let id = chars[rng(0, chars.length - 1)];
  for (let i = 1; i < len; i++) {
    const pool = chars + digits;
    id += pool[rng(0, pool.length - 1)];
  }
  return id;
}

function randHex(rng, len = 8) {
  let h = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < len; i++) h += hex[rng(0, 15)];
  return h;
}

// ─── FAKE CONTENT GENERATORS ────────────────────────────────────────────────

function generateFakeJS(pathKey) {
  const rng = makeRng(pathKey);
  const numFunctions = rng(8, 25);
  const lines = [];

  lines.push(`/* ${randWord(ADJECTIVES, rng)} ${randWord(NOUNS, rng)} v${rng(1,9)}.${rng(0,99)}.${rng(0,9)} */`);
  lines.push(`'use strict';`);
  lines.push('');

  // Fake imports/requires
  const numImports = rng(2, 6);
  for (let i = 0; i < numImports; i++) {
    const mod = `${randWord(ADJECTIVES, rng)}-${randWord(NOUNS, rng)}`;
    const alias = randIdentifier(rng);
    lines.push(`const ${alias} = require('${mod}');`);
  }
  lines.push('');

  // Fake constants
  const numConsts = rng(3, 8);
  for (let i = 0; i < numConsts; i++) {
    const name = randIdentifier(rng).toUpperCase();
    const val = rng(0, 1) === 0 ? `'${randHex(rng, rng(8,32))}'` : rng(100, 99999);
    lines.push(`const ${name} = ${val};`);
  }
  lines.push('');

  // Fake class
  const className = randWord(NOUNS, rng).charAt(0).toUpperCase() + randWord(NOUNS, rng).slice(1);
  lines.push(`class ${className} {`);
  lines.push(`  constructor(options = {}) {`);
  for (let i = 0; i < rng(2, 5); i++) {
    const prop = randWord(NOUNS, rng);
    const val = rng(0, 2) === 0 ? `options.${prop} || null` : rng(0, 1) === 0 ? `'${randHex(rng, 8)}'` : rng(0, 100);
    lines.push(`    this.${prop} = ${val};`);
  }
  lines.push(`  }`);
  lines.push('');

  for (let i = 0; i < rng(3, 7); i++) {
    const methodName = randWord(VERBS, rng) + randWord(NOUNS, rng).charAt(0).toUpperCase() + randWord(NOUNS, rng).slice(1);
    const isAsync = rng(0, 1);
    lines.push(`  ${isAsync ? 'async ' : ''}${methodName}(${randIdentifier(rng)}) {`);
    // fake method body
    const numStmts = rng(2, 8);
    for (let j = 0; j < numStmts; j++) {
      const v = randIdentifier(rng);
      lines.push(`    const ${v} = ${isAsync && rng(0,1) ? 'await ' : ''}this.${randWord(NOUNS, rng)};`);
    }
    lines.push(`    return ${randIdentifier(rng)};`);
    lines.push(`  }`);
    lines.push('');
  }
  lines.push(`}`);
  lines.push('');

  // Fake standalone functions
  for (let i = 0; i < numFunctions; i++) {
    const fnName = randWord(VERBS, rng) + randWord(NOUNS, rng).charAt(0).toUpperCase() + randWord(NOUNS, rng).slice(1);
    const isAsync = rng(0, 2) === 0;
    lines.push(`${isAsync ? 'async ' : ''}function ${fnName}(${randIdentifier(rng)}, ${randIdentifier(rng)}) {`);
    const numStmts = rng(3, 12);
    for (let j = 0; j < numStmts; j++) {
      const v = randIdentifier(rng);
      const val = rng(0, 3) === 0 ? `'${randHex(rng, rng(4,16))}'` : rng(0, 9999);
      lines.push(`  const ${v} = ${val};`);
    }
    lines.push(`  return ${randIdentifier(rng)};`);
    lines.push(`}`);
    lines.push('');
  }

  // Fake module.exports
  lines.push(`module.exports = { ${className}, ${Array.from({length: rng(3,8)}, () => randWord(VERBS, rng) + randWord(NOUNS, rng).charAt(0).toUpperCase() + randWord(NOUNS, rng).slice(1)).join(', ')} };`);

  return lines.join('\n');
}

function generateFakeHTML(pathKey, depth = 0) {
  const rng = makeRng(pathKey);
  const title = `${randWord(ADJECTIVES, rng)} ${randWord(NOUNS, rng)} ${randWord(VERBS, rng)}er`;

  // Generate trap links — each links back into /trap/... with a new path
  const numLinks = rng(15, 40);
  const links = [];
  for (let i = 0; i < numLinks; i++) {
    const childPath = `/trap/${randWord(NOUNS, rng)}/${randWord(VERBS, rng)}/${randHex(rng, 8)}`;
    const linkText = `${randWord(ADJECTIVES, rng)} ${randWord(NOUNS, rng)}`;
    links.push(`<a href="${childPath}">${linkText}</a>`);
  }

  // Fake script tags pointing back into trap
  const numScripts = rng(3, 8);
  const scriptTags = [];
  for (let i = 0; i < numScripts; i++) {
    scriptTags.push(`<script src="/trap/js/${randHex(rng, 12)}.js"></script>`);
  }

  // Fake API endpoint references
  const numApis = rng(4, 10);
  const apiRefs = [];
  for (let i = 0; i < numApis; i++) {
    apiRefs.push(`  <!-- API: /trap/api/${randWord(NOUNS, rng)}/${randHex(rng, 8)} -->`);
  }

  const paragraphs = [];
  for (let p = 0; p < rng(3, 8); p++) {
    const words = Array.from({length: rng(20, 60)}, () => randWord([...NOUNS, ...VERBS, ...ADJECTIVES], rng));
    paragraphs.push(`<p>${words.join(' ')}</p>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="/trap/css/${randHex(rng, 8)}.css">
  ${apiRefs.join('\n  ')}
</head>
<body>
  <header>
    <h1>${title}</h1>
    <nav>
      ${links.slice(0, 8).join('\n      ')}
    </nav>
  </header>
  <main>
    <section>
      <h2>${randWord(ADJECTIVES, rng)} ${randWord(NOUNS, rng)}</h2>
      ${paragraphs.slice(0, 3).join('\n      ')}
    </section>
    <section>
      <h2>${randWord(VERBS, rng)} ${randWord(NOUNS, rng)}</h2>
      ${paragraphs.slice(3).join('\n      ')}
      <ul>
        ${links.slice(8, 20).map(l => `<li>${l}</li>`).join('\n        ')}
      </ul>
    </section>
    <footer>
      ${links.slice(20).join(' | ')}
    </footer>
  </main>
  ${scriptTags.join('\n  ')}
</body>
</html>`;
}

function generateFakeJSON(pathKey) {
  const rng = makeRng(pathKey);

  const makeObj = (depth = 0) => {
    if (depth > 3) return randHex(rng, 8);
    const obj = {};
    const numKeys = rng(2, 8);
    for (let i = 0; i < numKeys; i++) {
      const key = randWord(NOUNS, rng) + '_' + randWord(VERBS, rng);
      const type = rng(0, 4);
      if (type === 0) obj[key] = makeObj(depth + 1);
      else if (type === 1) obj[key] = Array.from({length: rng(2, 6)}, () => makeObj(depth + 1));
      else if (type === 2) obj[key] = randHex(rng, 16);
      else if (type === 3) obj[key] = rng(0, 999999);
      else obj[key] = rng(0, 1) === 0;
    }
    // Add fake next-page links
    obj['_links'] = {
      self: `/trap/api/${randWord(NOUNS, rng)}/${randHex(rng, 8)}`,
      next: `/trap/api/${randWord(NOUNS, rng)}/${randHex(rng, 8)}?page=${rng(1, 999)}`,
      prev: `/trap/api/${randWord(NOUNS, rng)}/${randHex(rng, 8)}?page=${rng(1, 999)}`,
    };
    return obj;
  };

  // Use a seeded fake timestamp so the entire response is deterministic.
  // Real scrapers don't validate timestamps — they just want the data structure.
  const fakeYear  = rng(2021, 2025);
  const fakeMon   = String(rng(1, 12)).padStart(2, '0');
  const fakeDay   = String(rng(1, 28)).padStart(2, '0');
  const fakeHour  = String(rng(0, 23)).padStart(2, '0');
  const fakeMin   = String(rng(0, 59)).padStart(2, '0');
  const fakeSec   = String(rng(0, 59)).padStart(2, '0');
  const fakeTs    = `${fakeYear}-${fakeMon}-${fakeDay}T${fakeHour}:${fakeMin}:${fakeSec}.000Z`;

  return JSON.stringify({
    status: 'ok',
    version: `${rng(1,5)}.${rng(0,9)}.${rng(0,99)}`,
    timestamp: fakeTs,
    data: Array.from({length: rng(5, 20)}, () => makeObj()),
  }, null, 2);
}

// Realistic CSS property values keyed by property name.
// Previously all values used randHex(3) which produced invalid CSS like
// "font-weight: 4f2" — a CSS parser would reject these. Real-looking values
// make the fake CSS more convincing to scrapers that validate syntax.
const CSS_VALUE_MAP = {
  'display':       ['block','flex','grid','inline-block','none'],
  'position':      ['relative','absolute','fixed','sticky'],
  'margin':        (rng) => `${rng(0,32)}px ${rng(0,32)}px`,
  'padding':       (rng) => `${rng(0,24)}px ${rng(0,24)}px`,
  'color':         (rng) => `#${randHex(rng,6)}`,
  'background':    (rng) => `#${randHex(rng,6)}`,
  'font-size':     (rng) => `${rng(10,24)}px`,
  'font-weight':   ['400','500','600','700','bold','normal'],
  'border':        (rng) => `${rng(1,3)}px solid #${randHex(rng,6)}`,
  'border-radius': (rng) => `${rng(0,24)}px`,
  'opacity':       (rng) => `0.${rng(1,9)}`,
  'transform':     (rng) => `translateX(${rng(0,100)}px)`,
  'transition':    (rng) => `all ${rng(1,5)}00ms ease`,
  'animation':     (rng) => `fade${rng(1,9)} ${rng(1,3)}s ease infinite`,
  'overflow':      ['hidden','scroll','auto','visible'],
  'z-index':       (rng) => `${rng(1,999)}`,
};

function cssValue(prop, rng) {
  const v = CSS_VALUE_MAP[prop];
  if (!v) return `${rng(0, 100)}px`;
  if (typeof v === 'function') return v(rng);
  return v[rng(0, v.length - 1)];
}

function generateFakeCSS(pathKey) {
  const rng = makeRng(pathKey);
  const lines = [`/* ${randWord(ADJECTIVES, rng)}-${randWord(NOUNS, rng)}.css */`];

  const cssprops = Object.keys(CSS_VALUE_MAP);
  const numRules = rng(20, 60);
  for (let i = 0; i < numRules; i++) {
    const selector = `.${randWord(ADJECTIVES, rng)}-${randWord(NOUNS, rng)}`;
    lines.push(`${selector} {`);
    const numProps = rng(2, 8);
    for (let j = 0; j < numProps; j++) {
      const prop = cssprops[rng(0, cssprops.length - 1)];
      lines.push(`  ${prop}: ${cssValue(prop, rng)};`);
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

// ─── REQUEST HANDLER ─────────────────────────────────────────────────────────

function logBotHit(req) {
  const ts = new Date().toISOString();
  const ua = req.headers['user-agent'] || 'NO_UA';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[BOT] ${ts} | ${ip} | ${req.method} ${req.url} | UA: ${ua}`);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  const botDetected = isBot(req);

  // ── Trap zone: /trap/* always serves generated content regardless ──
  const inTrap = pathname.startsWith('/trap/');

  if (!inTrap && !botDetected) {
    // Real user accessing real content — pass through (404 in standalone mode)
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  // Bot detected OR in trap zone → serve generated content
  logBotHit(req);

  // Artificial slow-down to waste scraper resources (100-800ms).
  // ℹ️  Using Math.random() here intentionally (NOT seededRand) so the delay
  //    varies per request even for the same URL — harder for bots to learn timings.
  // ⚠️  With no concurrency limit this could pile up under heavy bot load.
  //    Consider: if (server._connections > 50) return res.destroy();
  const delay = 100 + Math.floor(Math.random() * 700);

  setTimeout(() => {
    // Determine content type from path
    if (pathname.endsWith('.js') || pathname.includes('/trap/js/')) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'X-Trap': '1',
        'Cache-Control': 'no-cache',
      });
      res.end(generateFakeJS(pathname));

    } else if (pathname.endsWith('.css') || pathname.includes('/trap/css/')) {
      res.writeHead(200, {
        'Content-Type': 'text/css',
        'X-Trap': '1',
        'Cache-Control': 'no-cache',
      });
      res.end(generateFakeCSS(pathname));

    } else if (pathname.includes('/trap/api/') || pathname.endsWith('.json')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Trap': '1',
        'Cache-Control': 'no-cache',
      });
      res.end(generateFakeJSON(pathname));

    } else {
      // Default: fake HTML page with more trap links
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'X-Trap': '1',
        'Cache-Control': 'no-cache',
      });
      res.end(generateFakeHTML(pathname));
    }
  }, delay);
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   qalarc.com Bot Trap Server             ║`);
  console.log(`║   Listening on port ${PORT}                 ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  console.log(`Trap zone:  http://localhost:${PORT}/trap/`);
  console.log(`Bot hits will be logged above.\n`);
});

module.exports = { isBot, generateFakeJS, generateFakeHTML, generateFakeJSON };
