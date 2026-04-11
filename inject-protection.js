#!/usr/bin/env node
/**
 * inject-protection.js — Injects bot-trap-client.js into all project HTML files
 * 
 * Scans all HTML files across your web projects, and adds the client-side
 * honeypot script tag to the <head> (if not already present).
 * 
 * Usage:
 *   node inject-protection.js               # dry run — show what would change
 *   node inject-protection.js --run         # actually inject
 *   node inject-protection.js --remove      # remove injected tags
 *   node inject-protection.js --dir /path   # target specific dir
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const PROJECT_ROOTS = [
  '/home/fivelidz/projects/bella_website',
  '/home/fivelidz/projects/fivelidz_website/public_html',
  '/home/fivelidz/projects/Endispute_site',
  '/home/fivelidz/projects/projects-showcase-site',
];

// The tag we inject — marker comment makes it findable/removable
const INJECTION_MARKER = '<!-- qalarc-bot-trap -->';
const INJECTION_TAG = `  ${INJECTION_MARKER}<script src="/bot-trap-client.js" defer></script>`;

const SKIP_PATTERNS = [
  'node_modules', 'archive', '.git', 'backup', 'old', 'junk',
  'archive_originals', 'verbose_version',
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function shouldSkip(filePath) {
  return SKIP_PATTERNS.some(p => filePath.includes(p));
}

function collectHtmlFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) {
      collectHtmlFiles(full, results);
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.htm'))) {
      results.push(full);
    }
  }
  return results;
}

function injectFile(filePath, remove = false) {
  let content = fs.readFileSync(filePath, 'utf8');
  const alreadyInjected = content.includes(INJECTION_MARKER);

  if (remove) {
    if (!alreadyInjected) {
      console.log(`  SKIP (not injected): ${filePath}`);
      return;
    }
    // Remove the injected line
    content = content.split('\n')
      .filter(line => !line.includes(INJECTION_MARKER))
      .join('\n');
    // Archive before overwrite
    archiveFile(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  REMOVED: ${filePath}`);
    return;
  }

  if (alreadyInjected) {
    console.log(`  SKIP (already injected): ${filePath}`);
    return;
  }

  // Find <head> or <head ...> tag and inject after it
  const headMatch = content.match(/<head(\s[^>]*)?>(\s*\n?)/i);
  if (!headMatch) {
    console.log(`  SKIP (no <head> found): ${filePath}`);
    return;
  }

  const insertAfter = headMatch.index + headMatch[0].length;
  content = content.slice(0, insertAfter) + INJECTION_TAG + '\n' + content.slice(insertAfter);

  // Archive before overwrite
  archiveFile(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  INJECTED: ${filePath}`);
}

function archiveFile(filePath) {
  const dir = path.dirname(filePath);
  const archiveDir = path.join(dir, 'archive_originals');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const base = path.basename(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(archiveDir, `${base}.${ts}.bak`);
  fs.copyFileSync(filePath, archivePath);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = !args.includes('--run') && !args.includes('--remove');
const remove = args.includes('--remove');
const dirIndex = args.indexOf('--dir');
const customDir = dirIndex !== -1 ? args[dirIndex + 1] : null;

const roots = customDir ? [customDir] : PROJECT_ROOTS;

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   qalarc.com HTML Injection Tool         ║');
console.log('╚══════════════════════════════════════════╝\n');

if (dryRun) {
  console.log('MODE: DRY RUN (pass --run to inject, --remove to remove)\n');
}

let total = 0;

for (const root of roots) {
  const files = collectHtmlFiles(root);
  console.log(`\n📁 ${root}  (${files.length} HTML files found)`);

  for (const f of files) {
    total++;
    if (dryRun) {
      const content = fs.readFileSync(f, 'utf8');
      const status = content.includes(INJECTION_MARKER) ? '[already injected]' : '[would inject]';
      console.log(`  ${status} ${f}`);
    } else {
      injectFile(f, remove);
    }
  }
}

console.log(`\n✅ Total: ${total} HTML files ${dryRun ? 'found (dry run)' : remove ? 'processed (remove)' : 'processed (inject)'}\n`);

if (dryRun) {
  console.log('Run with --run to inject bot-trap-client.js into all <head> tags.');
  console.log('Run with --remove to strip all injected tags.\n');
}
