#!/usr/bin/env node
/**
 * deploy.js — Build + Deploy Pipeline for qalarc.com
 * 
 * STRATEGY:
 *   This script NEVER modifies your source files. It works in a temp build dir:
 * 
 *   1. COPY  — Mirror source project dirs to /tmp/qalarc-build/
 *   2. OBFUSCATE — Obfuscate all .js files IN the build copy (originals untouched)
 *   3. INJECT — Inject bot-trap-client.js into all HTML <head> tags in the build copy
 *   4. COPY CLIENT SCRIPT — Put bot-trap-client.js in each project's web root
 *   5. SYNC — rsync build copy → server via SSH
 * 
 * The bot-trap server (bot-trap.js) is deployed separately as a systemd service.
 * 
 * ──────────────────────────────────────────────────────────────────────────
 * USAGE:
 *   node deploy.js --dry-run          # show what would happen, no changes
 *   node deploy.js --build            # build obfuscated copy in /tmp/qalarc-build
 *   node deploy.js --deploy           # build + rsync to server
 *   node deploy.js --project bella    # only process bella_website
 *   node deploy.js --no-obfuscate     # inject only, skip obfuscation (fast)
 *   node deploy.js --no-inject        # obfuscate only, skip HTML injection
 *   node deploy.js --server-setup     # deploy bot-trap.js server to remote
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * SERVER CONFIG — edit the SERVERS section below before first use.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ─── SERVER CONFIG ────────────────────────────────────────────────────────────
// Edit these to match your server setup

const SERVERS = {
  // Main site — fivelidz.com / qalarc.com
  main: {
    host: 'fivelidz.com',           // SSH host (or IP)
    user: 'fivelidz',               // SSH username
    sshKey: '~/.ssh/id_ed25519',    // SSH key path
    remoteRoot: '/home/fivelidz/public_html',  // Remote web root
    botTrapDir: '/home/fivelidz/bot-trap',     // Where bot-trap.js lives on server
    trapPort: 4444,
  },
  // ⚠️  qalarc.com is Cloudflare Pages — SSH/rsync WILL NOT WORK here.
  //     Deployment = git push to fivelidz/qalarc.ai → CF auto-builds.
  //     bot-trap.js server cannot run on CF Pages (no persistent Node process).
  //     Use functions/_middleware.js in the qalarc.ai repo for CF bot trapping.
  //     These fields are placeholders only — do not run --deploy against this target.
  showcase: {
    host: 'qalarc.com',             // ⚠️ CF Pages — no SSH
    user: 'qalarc',
    sshKey: '~/.ssh/id_ed25519',
    remoteRoot: '/home/qalarc/public_html/projects', // ⚠️ doesn't exist on CF Pages
    botTrapDir: '/home/qalarc/bot-trap',
    trapPort: 4444,
  },
};

// ─── PROJECT TARGETS ─────────────────────────────────────────────────────────

const PROJECTS = [
  {
    name: 'bella',
    localSrc: '/home/fivelidz/projects/bella_website',
    server: 'main',
    remotePath: '/home/fivelidz/public_html/bella',
    description: 'Bella website',
  },
  {
    name: 'fivelidz',
    localSrc: '/home/fivelidz/projects/fivelidz_website/public_html',
    server: 'main',
    remotePath: '/home/fivelidz/public_html',
    description: 'fivelidz.com main site',
  },
  {
    name: 'endispute',
    localSrc: '/home/fivelidz/projects/Endispute_site',
    server: 'main',
    remotePath: '/home/fivelidz/public_html/endispute',
    description: 'Endispute site',
    // original_site/ and verbose_version/ are archived source backups — never deploy them.
    // buildSkip applies during the copy step; excludePatterns applies during rsync.
    buildSkip: ['original_site', 'verbose_version'],
    excludePatterns: ['original_site/', 'verbose_version/', 'archive*/'],
  },
  {
    name: 'showcase',
    localSrc: '/home/fivelidz/projects/projects-showcase-site',
    server: 'showcase',
    remotePath: '/home/qalarc/public_html/projects',
    description: 'Projects showcase site (qalarc.com/projects)',
  },
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BUILD_DIR = '/tmp/qalarc-build';
const CLIENT_SCRIPT_SRC = path.join(__dirname, 'bot-trap-client.js');
const BOT_TRAP_SRC = path.join(__dirname, 'bot-trap.js');

const SKIP_PATTERNS = [
  'node_modules', '.git', 'archive_originals', 'archive',
  'backup', '.obf.js', '.min.js',
];

const INJECTION_MARKER = '<!-- qalarc-bot-trap -->';
const INJECTION_TAG = `  ${INJECTION_MARKER}<script src="/bot-trap-client.js" defer></script>`;

// ─── OBFUSCATOR CONFIG ────────────────────────────────────────────────────────

const JavaScriptObfuscator = require('javascript-obfuscator');

// Full obfuscation — used for files < LARGE_FILE_THRESHOLD bytes.
// controlFlowFlattening + deadCodeInjection on 100KB+ files can take 2-5 min,
// so large files drop to OBFUSCATOR_OPTIONS_LIGHT instead.
const LARGE_FILE_THRESHOLD = 30 * 1024; // 30 KB

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
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

// Light obfuscation for large files — still renames identifiers and encodes
// strings, but skips control flow flattening and dead code injection which
// are the expensive O(n²) passes that make 100KB files take minutes.
const OBFUSCATOR_OPTIONS_LIGHT = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
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

function log(msg, level = 'info') {
  const prefix = { info: '  ', ok: '  ✅ ', warn: '  ⚠️  ', err: '  ❌ ', step: '\n🔧 ' };
  console.log((prefix[level] || '  ') + msg);
}

function shouldSkip(filePath, skipPatterns = SKIP_PATTERNS) {
  return skipPatterns.some(p => filePath.includes(p));
}

function copyDir(src, dest, skipPatterns = SKIP_PATTERNS) {
  if (!fs.existsSync(src)) { log(`Source not found: ${src}`, 'warn'); return; }
  fs.mkdirSync(dest, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (e) {
    log(`Cannot read dir (skipping): ${src}`, 'warn');
    return;
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (shouldSkip(s, skipPatterns)) continue;
    if (e.isDirectory()) copyDir(s, d, skipPatterns);
    else fs.copyFileSync(s, d);
  }
}

function collectFiles(dir, ext, results = [], skipPatterns = SKIP_PATTERNS) {
  if (!fs.existsSync(dir)) return results;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (shouldSkip(full, skipPatterns)) continue;
    if (e.isDirectory()) collectFiles(full, ext, results, skipPatterns);
    else if (e.isFile() && e.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function obfuscateDir(dir) {
  const jsFiles = collectFiles(dir, '.js');
  let count = 0;
  let skipped = 0;
  let lightCount = 0;
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    if (src.trim().length < 20) continue;
    // Choose obfuscation profile based on file size.
    // controlFlowFlattening on files >30KB can take several minutes — use light
    // profile for those to keep the build fast without losing identifier/string protection.
    const isLarge = src.length > LARGE_FILE_THRESHOLD;
    const opts = isLarge ? OBFUSCATOR_OPTIONS_LIGHT : OBFUSCATOR_OPTIONS;
    try {
      const result = JavaScriptObfuscator.obfuscate(src, opts);
      fs.writeFileSync(f, result.getObfuscatedCode(), 'utf8');
      count++;
      if (isLarge) lightCount++;
    } catch (e) {
      // Some files use non-strict JS patterns the obfuscator's parser rejects
      // (e.g. duplicate const declarations in same scope). Keep original unobfuscated.
      log(`Skipping (parser error) ${path.basename(f)}: ${e.message.split('\n')[0]}`, 'warn');
      skipped++;
    }
  }
  if (lightCount > 0) log(`${lightCount} large file(s) used light obfuscation profile`, 'info');
  if (skipped > 0) log(`${skipped} file(s) kept unobfuscated due to parse errors`, 'warn');
  return count;
}

function injectHoneypotDir(dir) {
  const htmlFiles = collectFiles(dir, '.html');
  let count = 0;
  for (const f of htmlFiles) {
    let content = fs.readFileSync(f, 'utf8');
    if (content.includes(INJECTION_MARKER)) continue;
    const headMatch = content.match(/<head(\s[^>]*)?>(\s*\n?)/i);
    if (!headMatch) continue;
    const insertAt = headMatch.index + headMatch[0].length;
    content = content.slice(0, insertAt) + INJECTION_TAG + '\n' + content.slice(insertAt);
    fs.writeFileSync(f, content, 'utf8');
    count++;
  }
  return count;
}

function copyClientScript(buildProjectDir) {
  // Place bot-trap-client.js at the web root of this project's build dir
  const dest = path.join(buildProjectDir, 'bot-trap-client.js');
  fs.copyFileSync(CLIENT_SCRIPT_SRC, dest);
}

function rsyncToServer(localPath, server, remotePath, excludes = [], dryRun = false) {
  const s = SERVERS[server];
  if (!s) { log(`Unknown server: ${server}`, 'err'); return false; }

  const excludeArgs = excludes.map(p => `--exclude='${p}'`).join(' ');
  const dryRunFlag = dryRun ? '--dry-run' : '';

  const cmd = [
    'rsync',
    '-avz',
    '--progress',
    '--delete',
    dryRunFlag,
    `--exclude='*.bak'`,
    `--exclude='archive_originals/'`,
    `--exclude='.git/'`,
    `--exclude='node_modules/'`,
    excludeArgs,
    `-e "ssh -i ${s.sshKey} -o StrictHostKeyChecking=no"`,
    `"${localPath}/"`,
    `"${s.user}@${s.host}:${remotePath}/"`,
  ].filter(Boolean).join(' ');

  log(`rsync command: ${cmd}`, 'info');

  const result = spawnSync('sh', ['-c', cmd], { stdio: 'inherit' });
  return result.status === 0;
}

function deployBotTrapServer(serverName, dryRun = false) {
  const s = SERVERS[serverName];
  if (!s) { log(`Unknown server: ${serverName}`, 'err'); return; }

  log(`Deploying bot-trap server to ${s.host}...`, 'step');

  if (dryRun) {
    log(`Would copy bot-trap.js to ${s.user}@${s.host}:${s.botTrapDir}/`, 'info');
    log(`Would run: npm install && node bot-trap.js (systemd or pm2)`, 'info');
    return;
  }

  // Create dir and copy files
  const setupCmds = [
    `mkdir -p ${s.botTrapDir}`,
    `cd ${s.botTrapDir} && npm init -y 2>/dev/null; true`,
  ].join(' && ');

  execSync(`ssh -i ${s.sshKey} ${s.user}@${s.host} "${setupCmds}"`, { stdio: 'inherit' });

  // Copy bot-trap.js
  execSync(
    `scp -i ${s.sshKey} ${BOT_TRAP_SRC} ${s.user}@${s.host}:${s.botTrapDir}/bot-trap.js`,
    { stdio: 'inherit' }
  );

  log(`Bot trap server deployed. SSH in and start with: PORT=${s.trapPort} node ${s.botTrapDir}/bot-trap.js`, 'ok');
  log(`Or install as systemd service — see nginx-bot-trap.conf for the service definition.`, 'info');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun   = args.includes('--dry-run');
const doBuild    = args.includes('--build') || args.includes('--deploy');
const doDeploy   = args.includes('--deploy');
const doServer   = args.includes('--server-setup');
const noObfuscate = args.includes('--no-obfuscate');
const noInject   = args.includes('--no-inject');
// Bug fix: indexOf returns -1 when --project is absent; -1+1=0 gives args[0]
// which is a wrong match. Guard with an explicit includes check first.
const projectIdx = args.indexOf('--project');
const projectArg = projectIdx !== -1 ? args[projectIdx + 1] : null;

const targets = projectArg
  ? PROJECTS.filter(p => p.name === projectArg)
  : PROJECTS;

if (targets.length === 0) {
  console.error(`No project found matching: ${projectArg}`);
  console.error(`Available: ${PROJECTS.map(p => p.name).join(', ')}`);
  process.exit(1);
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   qalarc.com Build + Deploy Pipeline                 ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

if (isDryRun) log('MODE: DRY RUN — no files will be modified or uploaded\n', 'warn');

if (!doBuild && !doServer) {
  console.log('Usage:');
  console.log('  node deploy.js --dry-run          Show what would happen');
  console.log('  node deploy.js --build             Build obfuscated copy in /tmp/qalarc-build');
  console.log('  node deploy.js --deploy            Build + rsync to server');
  console.log('  node deploy.js --project bella     Only process bella project');
  console.log('  node deploy.js --no-obfuscate      Skip JS obfuscation');
  console.log('  node deploy.js --no-inject         Skip HTML injection');
  console.log('  node deploy.js --server-setup      Deploy bot-trap server to remote');
  console.log('');
  process.exit(0);
}

// Handle server-only setup
if (doServer) {
  const serverNames = [...new Set(targets.map(p => p.server))];
  for (const s of serverNames) {
    deployBotTrapServer(s, isDryRun);
  }
}

if (!doBuild) process.exit(0);

// ── STEP 1: Clean build dir ──────────────────────────────────────────────────
log('Preparing build directory', 'step');
if (fs.existsSync(BUILD_DIR)) {
  if (!isDryRun) fs.rmSync(BUILD_DIR, { recursive: true });
  log(`Cleaned ${BUILD_DIR}`, 'ok');
}
if (!isDryRun) fs.mkdirSync(BUILD_DIR, { recursive: true });

// ── STEP 2-4: Per-project: copy, obfuscate, inject ──────────────────────────
for (const project of targets) {
  const buildDest = path.join(BUILD_DIR, project.name);

  log(`Processing: ${project.description}  [${project.name}]`, 'step');

  // 2a. Copy source to build dir
  // buildSkip entries are folder names that should never go into the build
  // (e.g. original_site/ and verbose_version/ for endispute)
  const buildSkipPatterns = [...SKIP_PATTERNS, ...(project.buildSkip || [])];
  log(`Copying ${project.localSrc} → ${buildDest}`);
  if (!isDryRun) {
    copyDir(project.localSrc, buildDest, buildSkipPatterns);
    log(`Copy complete`, 'ok');
  } else {
    if (project.buildSkip) log(`Excluding from build: ${project.buildSkip.join(', ')}`, 'info');
    log(`Would copy to ${buildDest}`, 'info');
  }

  // 2b. Copy bot-trap-client.js to project web root
  if (!isDryRun) {
    copyClientScript(buildDest);
    log(`bot-trap-client.js → ${buildDest}/bot-trap-client.js`, 'ok');
  }

  // 3. Obfuscate
  if (!noObfuscate) {
    log(`Obfuscating JS files...`);
    if (!isDryRun) {
      const jsCount = obfuscateDir(buildDest);
      log(`Obfuscated ${jsCount} JS files`, 'ok');
    } else {
      const jsFiles = collectFiles(project.localSrc, '.js');
      log(`Would obfuscate ${jsFiles.length} JS files`, 'info');
    }
  } else {
    log('Skipping JS obfuscation (--no-obfuscate)', 'warn');
  }

  // 4. Inject honeypot
  if (!noInject) {
    log(`Injecting honeypot into HTML files...`);
    if (!isDryRun) {
      const htmlCount = injectHoneypotDir(buildDest);
      log(`Injected into ${htmlCount} HTML files`, 'ok');
    } else {
      const htmlFiles = collectFiles(project.localSrc, '.html');
      log(`Would inject into ${htmlFiles.length} HTML files`, 'info');
    }
  } else {
    log('Skipping HTML injection (--no-inject)', 'warn');
  }

  // 5. Deploy via rsync
  if (doDeploy) {
    log(`Deploying to ${project.server} → ${project.remotePath}`);
    if (!isDryRun) {
      const ok = rsyncToServer(
        buildDest,
        project.server,
        project.remotePath,
        project.excludePatterns || [],
        false
      );
      if (ok) log(`Deployed ${project.name} successfully`, 'ok');
      else log(`Deploy failed for ${project.name}`, 'err');
    } else {
      rsyncToServer(
        buildDest,
        project.server,
        project.remotePath,
        project.excludePatterns || [],
        true
      );
    }
  }
}

log('\nPipeline complete.', 'ok');
if (doBuild && !doDeploy) {
  log(`Build output is in: ${BUILD_DIR}`, 'info');
  log(`Run with --deploy to sync to server.`, 'info');
}
