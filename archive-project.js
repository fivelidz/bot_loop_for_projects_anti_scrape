#!/usr/bin/env node
/**
 * archive-project.js — Snapshot all source files before any obfuscation
 *
 * Run this BEFORE any obfuscation or deploy step.
 * Creates a timestamped archive in the project's archive/ directory.
 *
 * Usage:
 *   node archive-project.js                        # archive all 4 projects
 *   node archive-project.js --project showcase     # archive one project
 *   node archive-project.js --dir /path/to/dir     # archive a specific dir
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PROJECTS = {
  showcase:  '/home/fivelidz/projects/projects-showcase-site',
  bella:     '/home/fivelidz/projects/bella_website',
  endispute: '/home/fivelidz/projects/Endispute_site',
  fivelidz:  '/home/fivelidz/projects/fivelidz_website/public_html',
};

const SKIP = ['node_modules', '.git', 'archive', 'archive_originals', '.min.js'];
const ARCHIVE_EXTS = ['.js', '.html', '.htm'];

function shouldSkip(p) { return SKIP.some(s => p.includes(s)); }

function collectFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) collectFiles(full, results);
    else if (ARCHIVE_EXTS.some(e => entry.name.endsWith(e))) results.push(full);
  }
  return results;
}

function archiveDir(srcDir, label) {
  if (!fs.existsSync(srcDir)) {
    console.log(`  SKIP (not found): ${srcDir}`);
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archiveRoot = path.join(srcDir, 'archive', `pre_obfuscation_${ts}`);
  fs.mkdirSync(archiveRoot, { recursive: true });

  const files = collectFiles(srcDir);
  let count = 0;
  for (const f of files) {
    const rel  = path.relative(srcDir, f);
    const dest = path.join(archiveRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
    count++;
  }

  console.log(`  ✅ ${label} — ${count} files → ${archiveRoot.replace(srcDir, '.')}/`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const projectArg = args[args.indexOf('--project') + 1] || null;
const dirArg     = args[args.indexOf('--dir') + 1]     || null;

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   Project Archiver                       ║');
console.log('╚══════════════════════════════════════════╝\n');

if (dirArg) {
  archiveDir(dirArg, path.basename(dirArg));
} else if (projectArg) {
  if (!PROJECTS[projectArg]) {
    console.error(`Unknown project: ${projectArg}. Available: ${Object.keys(PROJECTS).join(', ')}`);
    process.exit(1);
  }
  archiveDir(PROJECTS[projectArg], projectArg);
} else {
  for (const [name, dir] of Object.entries(PROJECTS)) {
    archiveDir(dir, name);
  }
}

console.log('\nDone. Archives saved inside each project\'s archive/ folder.\n');
