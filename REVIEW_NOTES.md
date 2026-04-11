# Bot Loop — Review Notes & Pending Work

**Status: PAUSED — code reviewed and annotated, CF Pages middleware not yet written**

---

## What's Done

- `bot-trap.js` — Node.js server, fully working. Review comments added inline.
- `bot-trap-client.js` — Browser-side honeypot, fully working. Review comments added.
- `deploy.js` — Build + rsync pipeline. Annotated with CF Pages warning.
- `obfuscate.js` — JS obfuscator wrapper. Bug noted (duplicate key).
- `inject-protection.js` — HTML injection tool. Clean, no issues.
- `nginx-bot-trap.conf` — Nginx config. Fine for VPS deployments.
- `robots-trap.txt` — Honeypot robots additions. Good design.

---

## Issues Found (fix before deploying)

### 🐛 obfuscate.js — duplicate `debugProtection` key
```js
// Line 50-51 — second value silently wins, first is dead code
debugProtection: true,   // ← REMOVE THIS LINE
debugProtection: false,  // ← this one wins, correct value
```

### 🐛 bot-trap.js — unused `crypto` import
```js
const crypto = require('crypto'); // imported but never used — remove or use it
```

### ⚠️ bot-trap.js — missing AI training crawlers in BOT_UA_PATTERNS
Add these (highest priority for IP protection):
```js
/GPTBot/i, /ChatGPT-User/i,   // OpenAI
/ClaudeBot/i, /anthropic-ai/i, // Anthropic
/CCBot/i,                       // Common Crawl — feeds most LLM training data
/Bytespider/i,                  // ByteDance / TikTok
/PerplexityBot/i,
/cohere-ai/i,
/Diffbot/i,
```

### ⚠️ bot-trap.js — no concurrency cap on the trap server
A determined attacker could hammer /trap/ to generate load on YOUR server.
Fix: add a connection limit or return 503 if concurrent connections exceed threshold.
```js
server.maxConnections = 100; // add after http.createServer(...)
```

### ⚠️ bot-trap-client.js — redirectToTrap() is visible to the bot
Using `window.location.replace()` tells the bot it's been caught.
Better: silent beacon, keep serving real content:
```js
fetch('/trap/beacon?src=' + btoa(location.href), {keepalive: true});
// don't redirect — let _middleware.js handle subsequent requests
```

---

## The Big Missing Piece — Cloudflare Pages Middleware

**qalarc.com is Cloudflare Pages, not nginx/VPS.**  
`bot-trap.js` CANNOT run on CF Pages (no persistent Node.js process).  
`deploy.js --deploy` with the `showcase` server WILL NOT WORK for qalarc.com.

The fix is `functions/_middleware.js` in the qalarc.ai repo — a CF Pages Function
that runs the same detection + generation logic at the edge.

**What it needs to do:**
- Same bot detection as bot-trap.js (UA patterns + header heuristics)
- Same procedural content generation (FNV-1a seed + Xorshift32 RNG)
- CF Workers compatible — no Node.js builtins, Web APIs only
- Respect CF's 10ms CPU budget (generation must be fast)
- Artificial delay via `await new Promise(r => setTimeout(r, 300+))` (wall-clock, not CPU)
- Pass real users through via `next()`

**Stub written at:** `qalarc.ai/functions/_middleware.js` — needs to be filled in.

---

## Deployment Path (once ready)

For **qalarc.com** (CF Pages):
```bash
# Add _middleware.js to qalarc.ai repo
cd ~/projects/MASTER_PROJECTS/qalarc.ai
git add functions/_middleware.js
git commit -m "Add bot tarpit middleware"
git push  # CF Pages auto-deploys
```

For **fivelidz.com** and other VPS sites (nginx):
```bash
# Start the trap server on the VPS
node bot-trap.js &   # or set up as systemd service (see nginx-bot-trap.conf)

# Inject honeypot script into HTML
node inject-protection.js --run

# Deploy with obfuscation
node deploy.js --deploy --project fivelidz
```
