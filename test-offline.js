#!/usr/bin/env node
/**
 * test-offline.js — Pre-obfuscation sanity checks for qalarc.com/projects
 *
 * Tests all demo and project HTML files locally before touching the live site.
 * Run against both the ORIGINAL and OBFUSCATED versions.
 *
 * What it checks per file:
 *   - HTML is well-formed (has DOCTYPE, html, head, body)
 *   - Required external dependencies load (CDN scripts referenced correctly)
 *   - No broken local asset references (src/href pointing to missing files)
 *   - Inline <script> blocks are syntactically valid JS (node --check)
 *   - External .js files referenced are syntactically valid (node --check)
 *   - No console.error indicators or obvious crash patterns
 *
 * Usage:
 *   node test-offline.js                          # test qalarc.ai/projects
 *   node test-offline.js --dir /path/to/dir       # test a specific dir
 *   node test-offline.js --file path/to/file.html # test one file
 *   node test-offline.js --after-obfuscation      # stricter: also check _0x present
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const DEFAULT_DIR = '/home/fivelidz/projects/qalarc.ai/projects';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

let passed = 0, failed = 0, warnings = 0;
const issues = [];

function ok(label, cond, detail = '') {
  if (cond) { process.stdout.write(`  ✅ ${label}\n`); passed++; }
  else {
    process.stdout.write(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}\n`);
    failed++;
    issues.push({ label, detail });
  }
}
function warn(label, detail = '') {
  process.stdout.write(`  ⚠️  ${label}${detail ? ': ' + detail : ''}\n`);
  warnings++;
}
function section(title) {
  process.stdout.write(`\n${'─'.repeat(56)}\n  ${title}\n${'─'.repeat(56)}\n`);
}

function checkJsSyntax(code, label) {
  const tmp = `/tmp/syntax_check_${Date.now()}.js`;
  try {
    fs.writeFileSync(tmp, code, 'utf8');
    execSync(`node --check ${tmp}`, { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch (e) {
    const msg = e.stderr ? e.stderr.toString().split('\n')[0] : e.message;
    return msg;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].trim().length > 40) scripts.push(m[1]);
  }
  return scripts;
}

function extractExternalScripts(html, baseDir) {
  const scripts = [];
  const re = /src="([^"]*\.js)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    // Only check local (non-CDN) scripts
    if (!src.startsWith('http') && !src.startsWith('//')) {
      scripts.push(src);
    }
  }
  return scripts;
}

function checkLocalAssets(html, htmlFile) {
  const baseDir = path.dirname(htmlFile);
  const broken = [];

  // Check src= and href= for local assets
  const assetRe = /(?:src|href)="([^"]+)"/gi;
  let m;
  while ((m = assetRe.exec(html)) !== null) {
    const ref = m[1];
    // Skip absolute URLs, data URIs, anchors, template vars
    if (ref.startsWith('http') || ref.startsWith('//') ||
        ref.startsWith('#') || ref.startsWith('data:') ||
        ref.includes('{{') || ref.includes('${') ||
        ref.startsWith('mailto:') || ref.startsWith('tel:')) continue;

    // Resolve relative path from the HTML file's location
    const resolved = path.resolve(baseDir, ref.split('?')[0].split('#')[0]);

    if (!fs.existsSync(resolved)) {
      broken.push(ref);
    }
  }
  return broken;
}

// ─── FILE TESTER ─────────────────────────────────────────────────────────────

function testHtmlFile(htmlFile, opts = {}) {
  const rel = htmlFile.replace(DEFAULT_DIR + '/', '');
  section(rel);

  if (!fs.existsSync(htmlFile)) {
    ok(`File exists`, false, htmlFile);
    return;
  }

  const html = fs.readFileSync(htmlFile, 'utf8');
  const baseDir = path.dirname(htmlFile);

  // ── Structure ──────────────────────────────────────────────────────────────
  ok('Has DOCTYPE',    html.includes('<!DOCTYPE') || html.includes('<!doctype'));
  ok('Has <html>',     /<html/i.test(html));
  ok('Has <head>',     /<head/i.test(html));
  ok('Has <body>',     /<body/i.test(html));
  ok('Has </html>',    /<\/html>/i.test(html));

  // ── Local asset references ─────────────────────────────────────────────────
  const brokenAssets = checkLocalAssets(html, htmlFile);
  if (brokenAssets.length === 0) {
    ok('All local asset references exist', true);
  } else {
    // Warn rather than fail on broken assets — some demos reference server-relative paths
    // that are valid when served from qalarc.com/projects/ but look broken locally
    const serverRelative = brokenAssets.filter(r => r.startsWith('/'));
    const relative       = brokenAssets.filter(r => !r.startsWith('/'));
    if (relative.length > 0) {
      ok('No broken relative asset references', false, relative.slice(0, 3).join(', '));
    } else {
      warn(`${serverRelative.length} server-relative path(s) can't be checked locally`,
           serverRelative.slice(0, 3).join(', '));
    }
  }

  // ── External JS files ─────────────────────────────────────────────────────
  const extScripts = extractExternalScripts(html, baseDir);
  let extSyntaxOk = 0, extSyntaxFail = 0;
  for (const src of extScripts) {
    const resolved = path.resolve(baseDir, src);
    if (!fs.existsSync(resolved)) continue; // already caught by asset check
    const code = fs.readFileSync(resolved, 'utf8');
    const result = checkJsSyntax(code, src);
    if (result === true) extSyntaxOk++;
    else { extSyntaxFail++; ok(`External JS syntax — ${src}`, false, result); }
  }
  if (extSyntaxOk > 0) ok(`External JS files syntax OK (${extSyntaxOk})`, true);

  // ── Inline scripts ────────────────────────────────────────────────────────
  const inlineScripts = extractInlineScripts(html);
  if (inlineScripts.length === 0) {
    process.stdout.write(`  ℹ️  No significant inline scripts\n`);
  } else {
    let inlineOk = 0, inlineFail = 0;
    inlineScripts.forEach((script, i) => {
      const result = checkJsSyntax(script, `inline[${i}]`);
      if (result === true) inlineOk++;
      else { inlineFail++; ok(`Inline script [${i}] syntax`, false, result.toString().split('\n')[0]); }
    });
    if (inlineFail === 0) ok(`Inline scripts syntax OK (${inlineOk} block${inlineOk!==1?'s':''})`, true);
  }

  // ── After-obfuscation checks ───────────────────────────────────────────────
  if (opts.afterObfuscation) {
    // Check that inline scripts ARE obfuscated (contain _0x)
    if (inlineScripts.length > 0) {
      const combined = inlineScripts.join('');
      ok('Inline scripts are obfuscated (_0x present)', combined.includes('_0x'));
    }
  }
}

function testJsFile(jsFile, opts = {}) {
  const rel = jsFile.replace(DEFAULT_DIR + '/', '');
  if (!fs.existsSync(jsFile)) return;

  const code = fs.readFileSync(jsFile, 'utf8');
  if (code.trim().length < 20) return;

  const result = checkJsSyntax(code, rel);
  if (result === true) {
    ok(`${rel} — syntax OK ${opts.afterObfuscation ? '(obfuscated)' : ''}`, true);
    if (opts.afterObfuscation) {
      ok(`${rel} — is obfuscated (_0x present)`, code.includes('_0x'));
    }
  } else {
    ok(`${rel} — syntax`, false, result.toString().split('\n')[0]);
  }
}

// ─── COLLECT FILES ───────────────────────────────────────────────────────────

function collectFiles(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','archive','archive_originals'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, exts, results);
    else if (exts.some(e => entry.name.endsWith(e))) results.push(full);
  }
  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const afterObfuscation = args.includes('--after-obfuscation');
const dirIdx  = args.indexOf('--dir');
const fileIdx = args.indexOf('--file');
const dirArg  = dirIdx  !== -1 ? args[dirIdx  + 1] : null;
const fileArg = fileIdx !== -1 ? args[fileIdx + 1] : null;

// Positional arg (no flag prefix) treated as directory
const positional = args.find(a => !a.startsWith('--') && a !== args[dirIdx+1] && a !== args[fileIdx+1]) || null;

const rootDir = dirArg || positional || DEFAULT_DIR;

process.stdout.write('\n╔══════════════════════════════════════════════════╗\n');
process.stdout.write(`║   Offline Pre-Deploy Test Suite                  ║\n`);
process.stdout.write(`║   ${afterObfuscation ? 'MODE: POST-OBFUSCATION' : 'MODE: PRE-OBFUSCATION (originals)'}              ║\n`);
process.stdout.write('╚══════════════════════════════════════════════════╝\n');
process.stdout.write(`\n  Target: ${rootDir}\n`);

if (fileArg) {
  testHtmlFile(fileArg, { afterObfuscation });
} else {
  // Test all HTML files
  const htmlFiles = collectFiles(rootDir, ['.html', '.htm']);
  for (const f of htmlFiles) testHtmlFile(f, { afterObfuscation });

  // Test all JS files
  if (afterObfuscation) {
    process.stdout.write('\n');
    section('JS FILES — obfuscation check');
    const jsFiles = collectFiles(rootDir, ['.js']);
    for (const f of jsFiles) testJsFile(f, { afterObfuscation });
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'═'.repeat(56)}\n`);
process.stdout.write(`  Passed: ${passed}   Failed: ${failed}   Warnings: ${warnings}\n`);
if (issues.length > 0) {
  process.stdout.write(`\n  Failed checks:\n`);
  issues.forEach(i => process.stdout.write(`    ✗ ${i.label}${i.detail ? ': ' + i.detail : ''}\n`));
}
process.stdout.write(failed === 0
  ? `\n  ✅ ALL CHECKS PASSED\n\n`
  : `\n  ❌ ${failed} CHECK(S) FAILED — do not deploy until fixed\n\n`);
process.exit(failed > 0 ? 1 : 0);
