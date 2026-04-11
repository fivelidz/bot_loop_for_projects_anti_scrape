#!/usr/bin/env node
/**
 * obfuscate-inline.js — Obfuscates inline <script> blocks inside HTML files
 *
 * The main obfuscator only processes .js files. HTML files with <script> blocks
 * (like the parallax demos) need this tool instead.
 *
 * It:
 *   1. Reads the HTML file
 *   2. Finds every inline <script> block (no src= attribute)
 *   3. Obfuscates the JS content using the same profile as obfuscate.js
 *   4. Archives the original first
 *   5. Writes the modified HTML back
 *
 * Usage:
 *   node obfuscate-inline.js path/to/file.html          # obfuscate one file
 *   node obfuscate-inline.js demos/parallax-tracking/   # obfuscate all HTML in a dir
 *   node obfuscate-inline.js --dry path/to/file.html    # preview only, no writes
 */

'use strict';

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs   = require('fs');
const path = require('path');

// ─── OBFUSCATOR OPTIONS ───────────────────────────────────────────────────────
// Same as obfuscate.js FULL profile — inline scripts are usually small
const OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1.0,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

// Light profile for large inline scripts (>30KB)
const OPTS_LIGHT = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1.0,
  unicodeEscapeSequence: false,
};

const LARGE_INLINE_THRESHOLD = 30 * 1024;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function archiveFile(filePath) {
  const dir = path.dirname(filePath);
  const archiveDir = path.join(dir, 'archive_originals');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const base = path.basename(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(archiveDir, `${base}.${ts}.bak`);
  fs.copyFileSync(filePath, archivePath);
  return archivePath;
}

function obfuscateInlineScripts(html, filePath) {
  const results = { count: 0, skipped: 0, totalOriginalBytes: 0, totalObfBytes: 0 };

  // Match <script> blocks without a src attribute
  // Handles: <script>, <script type="text/javascript">, <script type="module">
  // Does NOT match: <script src="...">, CDN scripts
  const scriptPattern = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

  const processed = html.replace(scriptPattern, (fullMatch, jsContent) => {
    const trimmed = jsContent.trim();

    // Skip empty scripts or very tiny ones (likely just comments or 1-liners)
    if (trimmed.length < 40) return fullMatch;

    results.totalOriginalBytes += trimmed.length;
    const opts = trimmed.length > LARGE_INLINE_THRESHOLD ? OPTS_LIGHT : OPTS;

    let obfuscated;
    try {
      const result = JavaScriptObfuscator.obfuscate(trimmed, opts);
      obfuscated = result.getObfuscatedCode();
    } catch (e) {
      console.warn(`  ⚠️  Could not obfuscate inline script in ${path.basename(filePath)}: ${e.message.split('\n')[0]}`);
      results.skipped++;
      return fullMatch;
    }

    results.count++;
    results.totalObfBytes += obfuscated.length;

    // Extract the opening <script ...> tag to preserve type/attributes
    const openTag = fullMatch.match(/^<script[^>]*>/i)[0];
    return `${openTag}\n${obfuscated}\n</script>`;
  });

  return { processed, results };
}

function processFile(filePath, dryRun) {
  if (!fs.existsSync(filePath)) {
    console.error(`  ❌ File not found: ${filePath}`);
    return;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const { processed, results } = obfuscateInlineScripts(html, filePath);

  if (results.count === 0 && results.skipped === 0) {
    console.log(`  SKIP (no inline scripts): ${filePath}`);
    return;
  }

  const ratio = results.totalOriginalBytes > 0
    ? Math.round(results.totalObfBytes / results.totalOriginalBytes * 100)
    : 0;

  if (dryRun) {
    console.log(`  DRY RUN: ${filePath}`);
    console.log(`    ${results.count} script block(s) would be obfuscated`);
    console.log(`    ${results.totalOriginalBytes} → ~${results.totalObfBytes} bytes (${ratio}% of original)`);
    if (results.skipped) console.log(`    ${results.skipped} block(s) would be skipped (parse errors)`);
    return;
  }

  const archivePath = archiveFile(filePath);
  fs.writeFileSync(filePath, processed, 'utf8');

  console.log(`  ✅ ${filePath}`);
  console.log(`     ${results.count} block(s) obfuscated · ${results.totalOriginalBytes} → ${results.totalObfBytes} bytes (${ratio}%)`);
  console.log(`     archive: ${archivePath}`);
  if (results.skipped) console.log(`     ⚠️  ${results.skipped} block(s) skipped (parse errors)`);
}

function collectHtmlFiles(dirOrFile) {
  const files = [];
  const stat = fs.existsSync(dirOrFile) ? fs.statSync(dirOrFile) : null;
  if (!stat) return files;

  if (stat.isFile()) {
    if (dirOrFile.endsWith('.html') || dirOrFile.endsWith('.htm')) files.push(dirOrFile);
  } else {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (['node_modules', '.git', 'archive', 'archive_originals'].includes(entry.name)) continue;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) files.push(full);
      }
    };
    walk(dirOrFile);
  }
  return files;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const targets = args.filter(a => !a.startsWith('--'));

if (targets.length === 0) {
  console.log(`
Usage:
  node obfuscate-inline.js path/to/file.html        # one file
  node obfuscate-inline.js demos/parallax-tracking/ # all HTML in a dir
  node obfuscate-inline.js --dry path/to/file.html  # preview only

Obfuscates inline <script> blocks (no src= attribute) inside HTML files.
Archives originals to archive_originals/ before writing.
`);
  process.exit(0);
}

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   Inline Script Obfuscator               ║');
if (dryRun) console.log('║   MODE: DRY RUN                          ║');
console.log('╚══════════════════════════════════════════╝\n');

let totalFiles = 0;
for (const target of targets) {
  const files = collectHtmlFiles(target);
  for (const f of files) {
    totalFiles++;
    processFile(f, dryRun);
  }
}

console.log(`\n✅ Processed ${totalFiles} HTML file(s)\n`);
