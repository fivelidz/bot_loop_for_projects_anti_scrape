#!/usr/bin/env node
/**
 * verify-live.js — Checks the live qalarc.com site for obfuscation + functionality
 *
 * Tests:
 *   1. All project URLs return HTTP 200
 *   2. Every JS file served is obfuscated (contains _0x identifiers)
 *   3. robots.txt and sitemap.xml are served correctly
 *   4. SEO meta tags are present
 *
 * Usage:
 *   node verify-live.js              # check everything
 *   node verify-live.js --quick      # skip JS content checks, just HTTP status
 */

'use strict';

const https = require('https');
const http  = require('http');

const BASE = 'https://qalarc.com/projects';

// ─── URLS TO TEST ─────────────────────────────────────────────────────────────

const PAGES = [
  { url: `${BASE}/`,                                    expect: 200, label: 'Homepage' },
  { url: `${BASE}/project/?slug=camera-biomarkers`,     expect: 200, label: 'Project page — biomarkers' },
  { url: `${BASE}/project/?slug=parallax-tracking`,     expect: 200, label: 'Project page — parallax' },
  { url: `${BASE}/project/?slug=bot-loop-anti-scrape`,  expect: 200, label: 'Project page — bot-trap' },
  { url: `${BASE}/project/?slug=qalcode`,               expect: 200, label: 'Project page — qalcode' },
  { url: `${BASE}/demos/camera-biomarkers/`,            expect: 200, label: 'Demo — biomarker analyzer' },
  { url: `${BASE}/demos/parallax-tracking/`,            expect: 200, label: 'Demo — parallax tracking' },
];

const JS_FILES = [
  { url: `${BASE}/assets/js/main.js`,            label: 'main.js' },
  { url: `${BASE}/assets/js/project-page.js`,    label: 'project-page.js' },
  { url: `${BASE}/assets/js/background.js`,      label: 'background.js' },
  { url: `${BASE}/demos/camera-biomarkers/analyzer-full.js`, label: 'demos/biomarker/analyzer-full.js' },
  { url: `${BASE}/demos/camera-biomarkers/app_v5.js`,        label: 'demos/biomarker/app_v5.js' },
];

const SEO_CHECKS = [
  { url: `${BASE}/robots.txt`,   label: 'robots.txt',   mustContain: 'User-agent', mustNotContain: '<html>' },
  { url: `${BASE}/sitemap.xml`,  label: 'sitemap.xml',  mustContain: '<urlset',    mustNotContain: '<html>' },
];

const META_CHECKS = [
  { url: `${BASE}/`, label: 'Homepage OG tags', checks: [
    { text: 'og:title',       label: 'og:title present' },
    { text: 'og:description', label: 'og:description present' },
    { text: 'canonical',      label: 'canonical present' },
  ]},
];

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

function fetch(url, options = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const timeout = options.timeout || 8000;

    let data = '';
    const req = lib.get(url, { timeout }, (res) => {
      res.on('data', chunk => { if (data.length < 50000) data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });

    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

// ─── TEST RUNNER ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0, warnings = 0;

function ok(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function warn(label, detail = '') { console.log(`  ⚠️  ${label}${detail ? ': ' + detail : ''}`); warnings++; }
function section(title) { console.log(`\n${'─'.repeat(52)}\n  ${title}\n${'─'.repeat(52)}`); }

async function run() {
  const quick = process.argv.includes('--quick');

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   qalarc.com Live Verification               ║');
  console.log(`║   ${new Date().toISOString().slice(0,19).replace('T',' ')}                   ║`);
  console.log('╚══════════════════════════════════════════════╝');

  // ── 1. Page availability ──────────────────────────────────────────────────
  section('1. Page Availability');
  for (const p of PAGES) {
    const res = await fetch(p.url);
    ok(`${p.label} → HTTP ${res.status}`, res.status === p.expect,
       res.error || `got ${res.status}`);
  }

  if (quick) { printResults(); return; }

  // ── 2. JS obfuscation ─────────────────────────────────────────────────────
  section('2. JS Obfuscation');
  for (const f of JS_FILES) {
    const res = await fetch(f.url);
    if (res.status !== 200) {
      warn(`${f.label} — HTTP ${res.status} (file may not exist yet)`);
      continue;
    }
    const isObf = res.body.includes('_0x');
    const preview = res.body.slice(0, 60).replace(/\n/g, ' ');
    ok(`${f.label} is obfuscated`, isObf, isObf ? '' : `starts: "${preview}"`);
  }

  // ── 3. Inline script obfuscation (demo HTML files) ──────────────────────
  section('3. Inline Scripts (Demo HTML)');
  const demoPages = [
    { url: `${BASE}/demos/camera-biomarkers/`, label: 'Biomarker demo' },
    { url: `${BASE}/demos/parallax-tracking/`, label: 'Parallax demo' },
  ];
  for (const p of demoPages) {
    const res = await fetch(p.url);
    if (res.status !== 200) { warn(`${p.label} — not accessible`); continue; }
    // Check for inline scripts (find <script> without src)
    const inlineScripts = (res.body.match(/<script(?![^>]*\bsrc)[^>]*>([\s\S]*?)<\/script>/gi) || []);
    const hasInlineJs = inlineScripts.some(s => s.length > 200);
    if (!hasInlineJs) {
      ok(`${p.label} — no significant inline scripts`, true);
      continue;
    }
    // Check if the inline scripts are obfuscated
    const combined = inlineScripts.join('');
    const isObf = combined.includes('_0x');
    ok(`${p.label} — inline scripts obfuscated`, isObf,
       isObf ? '' : 'inline JS is still plain source');
  }

  // ── 4. SEO files ──────────────────────────────────────────────────────────
  section('4. SEO Files');
  for (const s of SEO_CHECKS) {
    const res = await fetch(s.url);
    ok(`${s.label} — HTTP 200`,        res.status === 200, `got ${res.status}`);
    ok(`${s.label} — correct content`, res.body.includes(s.mustContain),  `missing: ${s.mustContain}`);
    ok(`${s.label} — not HTML page`,   !res.body.includes(s.mustNotContain), 'serving HTML instead of file');
  }

  // ── 5. SEO meta tags ──────────────────────────────────────────────────────
  section('5. SEO Meta Tags');
  for (const m of META_CHECKS) {
    const res = await fetch(m.url);
    if (res.status !== 200) { warn(`${m.label} — page not accessible`); continue; }
    for (const c of m.checks) {
      ok(`${m.label} — ${c.label}`, res.body.includes(c.text));
    }
  }

  printResults();
}

function printResults() {
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  Passed: ${passed}  Failed: ${failed}  Warnings: ${warnings}`);
  console.log(failed === 0
    ? `\n  ✅ ALL CHECKS PASSED\n`
    : `\n  ❌ ${failed} CHECK(S) FAILED\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
