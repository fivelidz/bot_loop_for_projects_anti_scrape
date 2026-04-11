# qalarc.com Anti-Scrape Protection System

Three-layer system to protect your JS projects from scrapers and code thieves.

---

## The Three Layers

```
Layer 1: JS Obfuscation     — Makes your code unreadable even if stolen
Layer 2: Bot Trap Server    — Infinite generative loop that wastes scraper CPU/bandwidth  
Layer 3: Client Honeypot    — Browser-side detection + clipboard poisoning + honeypot links
```

---

## Files

| File | Purpose |
|------|---------|
| `obfuscate.js` | Obfuscates all project JS files |
| `bot-trap.js` | Standalone server — infinite loop generator for scrapers |
| `bot-trap-client.js` | Drop into HTML `<head>` — browser-side detection + honeypot |
| `inject-protection.js` | Auto-injects `bot-trap-client.js` into all project HTML files |
| `nginx-bot-trap.conf` | Nginx config to route bots to the trap server |
| `robots-trap.txt` | robots.txt additions |

---

## Layer 1 — JS Obfuscation

### Quick start
```bash
# Dry run — see what files would be processed
node obfuscate.js

# Create .obf.js files alongside originals (safe, non-destructive)
node obfuscate.js --run

# Obfuscate IN-PLACE (archives originals to archive_originals/ first)
node obfuscate.js --inplace

# Target a specific directory
node obfuscate.js --run --dir /path/to/your/project
```

### What it does
- Renames all variables/functions to hex identifiers (`_0x1a2b`, etc.)
- Splits and base64-encodes all strings
- Adds control flow flattening (scrambles execution order)
- Adds dead code injection (fake code paths to confuse reverse engineering)
- Adds `selfDefending` — code detects if it's been reformatted and breaks
- Doesn't rename globals — won't break your API surface

### Workflow
1. Work on your **original** `.js` files as normal
2. Before deploying, run `node obfuscate.js --run`
3. Upload the `.obf.js` files, NOT the originals
4. Update your HTML `<script src="app.obf.js">` references

---

## Layer 2 — Bot Trap Server

### Quick start
```bash
# Run the trap server
node bot-trap.js

# Custom port
PORT=8888 node bot-trap.js
```

### What it does
- Serves from `/trap/` endpoint
- Each request generates **unique, deterministic fake content** based on URL path
- Fake JS files with convincing function names, classes, imports
- Fake HTML pages with 15-40 links that all loop back into `/trap/...`
- Fake JSON API responses with fake pagination (`next`, `prev` links)
- Fake CSS files
- Each response is delayed 100-800ms to waste scraper time
- Logs every bot hit with IP, UA, and URL

### Content types served
| URL pattern | Content |
|-------------|---------|
| `/trap/*.js` or `/trap/js/*` | Fake JavaScript module |
| `/trap/*.css` or `/trap/css/*` | Fake CSS |
| `/trap/api/*` or `*.json` | Fake JSON API response |
| Everything else | Fake HTML with trap links |

### The loop
Every fake HTML page contains 15-40 links pointing to other `/trap/...` paths.
Every fake JSON response has `_links.next` and `_links.prev` pointing to more `/trap/api/...` paths.
Every fake JS file `require()`s from fake module names.

A scraper following links will **never escape** — it just generates more and more pages from itself.

---

## Layer 3 — Client Honeypot

### Quick start
Add to your HTML `<head>`:
```html
<script src="/bot-trap-client.js" defer></script>
```

Or auto-inject into all project HTML files:
```bash
# Dry run
node inject-protection.js

# Inject into all HTML files
node inject-protection.js --run

# Remove injected tags
node inject-protection.js --remove

# Target specific dir
node inject-protection.js --run --dir /path/to/project
```

### What it does
- **Headless browser detection** — checks for `navigator.webdriver`, missing plugins, screen size anomalies, patched native functions
- **Invisible honeypot links** — injected into a hidden `<div>` (real users never see them; scrapers parsing HTML do)
- **Clipboard poisoning** — if someone copies >50 chars of your code, a `/* ⚠️ protected */` warning + trace ID gets appended
- **Bot redirect** — detected headless browsers get redirected to `/trap/entry`
- **Self-defense** — detects if the code itself has been reformatted/beautified

---

## Nginx Setup (Production)

See `nginx-bot-trap.conf` for the full config. Key steps:

1. Add the `map $http_user_agent $is_bot` block to your nginx `http {}` context
2. Add the `location /trap/` block to proxy to `bot-trap.js` on port 4444
3. Add the bot redirect `if ($is_bot = 1)` to your main `location /` block
4. Start the trap server as a systemd service (config in `nginx-bot-trap.conf`)

---

## Deployment Checklist

- [ ] `node obfuscate.js --run` — obfuscate all JS
- [ ] Upload `.obf.js` files to server, update HTML references
- [ ] Copy `bot-trap-client.js` to your server's web root
- [ ] `node inject-protection.js --run` — inject into all HTML
- [ ] Start `node bot-trap.js` on server (port 4444)
- [ ] Apply nginx config from `nginx-bot-trap.conf`
- [ ] Update `robots.txt` with entries from `robots-trap.txt`
- [ ] Test: `curl -A "scrapy/1.0" https://qalarc.com/` — should redirect to `/trap/`

---

## Testing

```bash
# Test the trap server
node bot-trap.js &
curl http://localhost:4444/trap/test          # should return fake HTML
curl http://localhost:4444/trap/js/bundle.js   # should return fake JS
curl http://localhost:4444/trap/api/data       # should return fake JSON

# Test obfuscator
node obfuscate.js --run --dir /path/to/test
```

---

## Notes

- Original files are **always archived** before any in-place modification
- Search engines (Google, Bing) are explicitly allowed through
- The trap is self-referential — no external dependencies, no state, no DB
- Works on any Linux server with Node.js ≥ 14
