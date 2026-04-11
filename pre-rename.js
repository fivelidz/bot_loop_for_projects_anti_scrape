#!/usr/bin/env node
/**
 * pre-rename.js — Pre-obfuscation semantic aliasing
 * 
 * Applies a rename map to JS source files BEFORE obfuscation.
 * The obfuscator then encodes these already-misleading names further.
 * 
 * Even if a string leaks through obfuscation (e.g. as an object key used for
 * dynamic lookup), it will show a misleading API term, not the real one.
 * 
 * Strategy: replace gesture/domain-specific terms with plausible WebGL / Web Audio
 * API terms that exist in the browser and would confuse any analysis.
 * 
 * Usage:
 *   node pre-rename.js --dir /path/to/project   # rename all .js files
 *   node pre-rename.js --file path/to/file.js   # rename one file
 *   node pre-rename.js --dry --dir /path        # preview only
 *   node pre-rename.js --restore --dir /path    # restore from .prerename.bak
 */
'use strict';
const fs   = require('fs');
const path = require('path');

// ─── RENAME MAP ───────────────────────────────────────────────────────────────
// Keys: exact strings in source code (class names, event names, enum values,
//       preset names, config property names)
// Values: misleading replacements from real WebGL / Web Audio API vocabulary
//
// Rules:
//   - Replacements must be plausible in a WebGL/Audio codebase
//   - Longer/more specific terms first to avoid partial replacement
//   - Do NOT rename things that appear in HTML element IDs/data-attrs
//     (those are in the separate HTML layer, not in .js files)

const RENAME_MAP = [
  // ── Class names (most visible — always leak with renameGlobals:false) ────────
  ['GestureEngine',      'MediaStreamTrack'],      // real browser API class
  ['GestureMapper',      'AudioParamMap'],          // real Web Audio class
  ['GestureRenderer',    'OffscreenRenderTarget'],  // plausible WebGL term  
  ['SynthEngine',        'AudioWorkletNode'],        // real Web Audio class

  // ── Gesture enum values (leak as object keys + string comparisons) ────────────
  ['OPEN_PALM',          'DEPTH_STENCIL'],          // WebGL framebuffer attachment
  ['THUMBSUP',           'UNPACK_ALIGNMENT'],        // WebGL pixel store param
  ['POINT',              'LINES'],                   // WebGL draw mode (avoids POINTS/POINT collision)
  ['PEACE',              'LINE_STRIP'],              // WebGL draw mode
  ['FIST',               'TRIANGLE_FAN'],            // WebGL draw mode
  ['PINCH',              'VERTEX_ATTRIB'],           // WebGL vertex concept
  ['UNKNOWN',            'INVALID_ENUM'],            // WebGL error code (real)
  ['SWIPE',              'BUFFER_USAGE'],            // WebGL buffer hint
  ['RIGHT',              'FRONT_FACE'],              // WebGL face orientation
  ['UP',                 'FUNC_ADD'],                // WebGL blend equation

  // ── Config property names (leak through dynamic property access) ─────────────
  ['smoothingFactor',    'interpolationWeight'],     // shader/ML ambiguous
  ['pinchThreshold',     'quantizationStep'],        // DSP/audio term
  ['grabThreshold',      'attenuationRolloff'],      // Web Audio term
  ['pointExtendThreshold','sampleRateConversion'],   // audio term
  ['gestureConfirmFrames','bufferLatency'],           // audio/video term
  ['swipeVelocityThreshold','phaseVocoder'],         // audio DSP term
  ['swipeHistoryLength', 'convolverLength'],         // audio term

  // ── Event names (leak through emit() calls) ───────────────────────────────────
  ['gestureStart',       'bufferStart'],             // audio BufferSource
  ['gestureEnd',         'bufferEnd'],               // audio BufferSource
  ['gestureChanged',     'paramAutomation'],         // audio param change
  ['pinchStart',         'workletReady'],            // AudioWorklet event
  ['pinchMove',          'processorMessage'],        // AudioWorklet message
  ['pinchEnd',           'workletDispose'],          // AudioWorklet cleanup
  ['palmRoll',           'pannerOrient'],            // Web Audio PannerNode
  ['bindingAdded',       'nodeConnected'],           // Web Audio connect()
  ['bindingUpdated',     'gainScheduled'],           // audio scheduling
  ['bindingRemoved',     'nodeDisconnected'],        // Web Audio disconnect()
  ['targetChanged',      'destinationRouted'],       // audio routing

  // ── Internal state properties (leak as dynamic accessor strings) ─────────────
  ['smoothedLandmarks',  'filteredSamples'],         // DSP filter output
  ['positionHistory',    'ringBuffer'],              // audio ring buffer
  ['currentGesture',     'activeShader'],            // WebGL shader state
  ['previousGesture',    'previousShader'],          // WebGL state
  ['gestureConfirmCount','frameAccumulator'],         // rendering frame count
  ['pinchState',         'blendState'],              // WebGL blend state
  ['twoHand',            'stereoPair'],              // audio stereo concept
  ['crossPinch',         'crossfadePoint'],          // audio crossfade
  ['wristDist',          'channelCount'],            // Web Audio channel count
  ['wristAngle',         'phaseOffset'],             // DSP phase
  ['palmCenter',         'centroid'],                // geometry/shader
  ['palmDist',           'reverbTail'],              // audio reverb
  ['knuckleCenter',      'vertexCluster'],           // WebGL geometry
  ['indexTip',           'attrib0'],                 // WebGL vertex attrib
  ['thumbTip',           'attrib1'],                 // WebGL vertex attrib
  ['middleTip',          'attrib2'],                 // WebGL vertex attrib
  ['ringTip',            'attrib3'],                 // WebGL vertex attrib

  // ── Preset names (leak as object keys) ───────────────────────────────────────
  ['theremin',           'convolutionKernel'],       // audio convolution
  ['djscratch',          'fragmentDiscard'],         // GLSL discard
  ['drummer',            'ringModulator'],           // synthesis term
  ['bassline',           'lowPassCascade'],          // filter topology
  ['colorist',           'chromaKey'],               // video effect
  ['cosmicTheremin',     'spectralFlux'],            // audio analysis
  ['electricWebs',       'edgeDetectionKernel'],     // image processing
  ['motionPaint',        'velocityBuffer'],          // physics/shader
  ['zoomBlur',           'depthOfField'],            // post-processing
  ['palmConductor',      'amplitudeEnvelope'],       // synthesis term
  ['fingerDrums',        'sampleSlice'],             // audio sampling
  ['minimalTechno',      'phaseModulator'],          // FM synthesis
  ['visualizer',         'spectrogram'],             // audio viz
  ['djVisuals',          'compositeLayer'],          // WebGL compositing
  ['neonWebs',           'vertexWeights'],           // 3D skinning
  ['spaceSculptor',      'meshDisplacement'],        // 3D modeling
  ['deckMixLeft',        'panPosition'],             // audio panning
  ['deckTempoSync',      'clockDivider'],            // audio sync
  ['crossFaderSim',      'crossCorrelation'],        // DSP correlation
  ['pinkyExpress',       'filterEnvelope'],          // synth term
  ['mixUniverse',        'spatialAudio'],            // audio spatialization
  ['prism',              'dispersion'],              // optics/shader
  ['fingerDrums',        'keyframeBuffer'],          // animation term

  // ── Curve type names (leak through CURVES object + dynamic lookup) ────────────
  ['linear',             'NEAREST'],                 // WebGL texture filter
  ['ease',               'LINEAR'],                  // WebGL (but ambiguous)
  ['invert',             'MIRRORED_REPEAT'],         // WebGL wrap mode
  ['snap3',              'CLAMP_TO_EDGE'],           // WebGL wrap mode
  ['snap5',              'REPEAT'],                  // WebGL wrap mode

  // ── Source/target ID prefixes (partial matches in dotted paths) ──────────────
  // These appear as 'right.pinchAperture', 'synth.pitch' etc.
  // We rename the component words, which affects the full dotted string too
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function applyRenames(src) {
  let out = src;
  let changes = 0;
  for (const [from, to] of RENAME_MAP) {
    // Word boundary replacement to avoid partial matches
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const before = out;
    out = out.replace(re, to);
    if (out !== before) changes++;
  }
  return { code: out, changes };
}

function processFile(filePath, dryRun, restore) {
  if (!fs.existsSync(filePath)) return;
  
  if (restore) {
    const bakPath = filePath + '.prerename.bak';
    if (fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, filePath);
      console.log(`  ✅ Restored: ${filePath}`);
    } else {
      console.log(`  ⚠️  No backup: ${filePath}`);
    }
    return;
  }

  const src = fs.readFileSync(filePath, 'utf8');
  const { code, changes } = applyRenames(src);

  if (changes === 0) {
    console.log(`  SKIP (0 matches): ${path.basename(filePath)}`);
    return;
  }

  if (dryRun) {
    console.log(`  DRY RUN: ${path.basename(filePath)} — ${changes} rename(s) applied`);
    // Show sample changes
    for (const [from, to] of RENAME_MAP) {
      if (src.includes(from)) console.log(`    '${from}' → '${to}'`);
    }
    return;
  }

  // Archive original
  fs.writeFileSync(filePath + '.prerename.bak', src);
  fs.writeFileSync(filePath, code);
  console.log(`  ✅ ${path.basename(filePath)}: ${changes} rename(s) — backup saved`);
}

function collectJs(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','archive','archive_originals'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...collectJs(full));
    else if (e.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun  = args.includes('--dry');
const restore = args.includes('--restore');
const dirIdx  = args.indexOf('--dir');
const fileIdx = args.indexOf('--file');
const dirArg  = dirIdx  !== -1 ? args[dirIdx  + 1] : null;
const fileArg = fileIdx !== -1 ? args[fileIdx + 1] : null;

console.log('\n╔══════════════════════════════════════════╗');
console.log(`║   Pre-Rename Tool ${dryRun?'(DRY RUN)':'          '}          ║`);
console.log('╚══════════════════════════════════════════╝\n');

if (fileArg) {
  processFile(fileArg, dryRun, restore);
} else if (dirArg) {
  const files = collectJs(dirArg);
  console.log(`Found ${files.length} JS files in ${dirArg}\n`);
  files.forEach(f => processFile(f, dryRun, restore));
} else {
  console.log('Usage:');
  console.log('  node pre-rename.js --dir /path/to/project');
  console.log('  node pre-rename.js --file path/to/file.js');
  console.log('  node pre-rename.js --dry --dir /path');
  console.log('  node pre-rename.js --restore --dir /path');
}
console.log('\nDone.\n');
