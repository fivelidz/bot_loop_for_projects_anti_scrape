#!/usr/bin/env node
/**
 * obfuscate.js — qalarc.com JS Obfuscator
 * 
 * Scans project directories for .js files, obfuscates them using
 * javascript-obfuscator, and writes .obf.js versions (originals untouched).
 * 
 * Can also do IN-PLACE obfuscation with --inplace flag (archives first).
 * 
 * Usage:
 *   node obfuscate.js                        # dry-run, list what would be processed
 *   node obfuscate.js --run                  # obfuscate → .obf.js next to originals
 *   node obfuscate.js --inplace              # obfuscate IN-PLACE (archives originals first)
 *   node obfuscate.js --dir /path/to/dir     # target a specific directory
 *   node obfuscate.js --run --dir /path      # run on specific dir
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const PROJECT_ROOTS = [
  '/home/fivelidz/projects/bella_website',
  '/home/fivelidz/projects/fivelidz_website/public_html',
  '/home/fivelidz/projects/Endispute_site',
  '/home/fivelidz/projects/projects-showcase-site',
];

// Folders/patterns to skip
const SKIP_PATTERNS = [
  'node_modules',
  'archive',
  '.git',
  'backup',
  'old',
  'junk',
  '.min.js',
  '.obf.js',
];

// Files larger than this use OBFUSCATOR_OPTIONS_LIGHT to keep build times reasonable.
// controlFlowFlattening on 100KB files can take several minutes — not worth the wait.
const LARGE_FILE_THRESHOLD = 30 * 1024; // 30 KB

// Full obfuscation — used for files under the threshold.
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,       // intentionally false — true causes devtools infinite loops
  disableConsoleOutput: false,  // keep false — your own console.log calls still work
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,         // keep false — don't break global API surface
  selfDefending: true,          // output detects if it's been reformatted and breaks
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
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
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

// Light obfuscation — used for large files. Still renames identifiers and
// base64-encodes strings but skips the O(n²) control-flow passes.
const OBFUSCATOR_OPTIONS_LIGHT = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  unicodeEscapeSequence: false,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function shouldSkip(filePath) {
  return SKIP_PATTERNS.some(p => filePath.includes(p));
}

function collectJsFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // Skip directories we can't read (permission denied, etc.)
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) {
      collectJsFiles(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function obfuscateFile(filePath, inplace = false) {
  const src = fs.readFileSync(filePath, 'utf8');

  // Skip already-tiny or empty files
  if (src.trim().length < 20) {
    console.log(`  SKIP (too small): ${filePath}`);
    return;
  }

  const opts = src.length > LARGE_FILE_THRESHOLD ? OBFUSCATOR_OPTIONS_LIGHT : OBFUSCATOR_OPTIONS;
  if (src.length > LARGE_FILE_THRESHOLD) {
    console.log(`  (large file ${Math.round(src.length/1024)}KB — using light profile)`);
  }

  let obfuscated;
  try {
    const result = JavaScriptObfuscator.obfuscate(src, opts);
    obfuscated = result.getObfuscatedCode();
  } catch (e) {
    console.error(`  ERROR obfuscating ${filePath}: ${e.message}`);
    return;
  }

  if (inplace) {
    // Archive original before overwriting
    const dir = path.dirname(filePath);
    const archiveDir = path.join(dir, 'archive_originals');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const base = path.basename(filePath);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archivePath = path.join(archiveDir, `${base}.${ts}.bak`);
    fs.copyFileSync(filePath, archivePath);
    fs.writeFileSync(filePath, obfuscated, 'utf8');
    console.log(`  OBFUSCATED (inplace): ${filePath}  [archive → ${archivePath}]`);
  } else {
    const outPath = filePath.replace(/\.js$/, '.obf.js');
    fs.writeFileSync(outPath, obfuscated, 'utf8');
    console.log(`  OBFUSCATED: ${outPath}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = !args.includes('--run') && !args.includes('--inplace');
const inplace = args.includes('--inplace');
const dirIndex = args.indexOf('--dir');
const customDir = dirIndex !== -1 ? args[dirIndex + 1] : null;

const roots = customDir ? [customDir] : PROJECT_ROOTS;

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   qalarc.com JS Obfuscator               ║');
console.log('╚══════════════════════════════════════════╝\n');

if (dryRun) {
  console.log('MODE: DRY RUN (pass --run or --inplace to actually obfuscate)\n');
}

let totalFiles = 0;

for (const root of roots) {
  const files = collectJsFiles(root);
  console.log(`\n📁 ${root}  (${files.length} JS files found)`);

  for (const f of files) {
    totalFiles++;
    if (dryRun) {
      console.log(`  → ${f}`);
    } else {
      obfuscateFile(f, inplace);
    }
  }
}

console.log(`\n✅ Total: ${totalFiles} JS files ${dryRun ? 'found (dry run)' : 'processed'}\n`);

if (dryRun && totalFiles > 0) {
  console.log('Run with --run to create .obf.js files alongside originals.');
  console.log('Run with --inplace to obfuscate in-place (archives originals first).\n');
}
