/**
 * bot-trap-client.js — Browser-side Honeypot + Bot Trap
 * 
 * Include this in your HTML <head> on ALL pages:
 *   <script src="/bot-trap-client.js"></script>
 * 
 * What it does:
 *   1. Detects headless/automated browsers via browser capability fingerprinting
 *   2. Injects invisible honeypot links (hidden from real users, visible to scrapers)
 *   3. If a bot clicks/fetches a honeypot link → redirects to /trap/ server
 *   4. Adds self-defending wrapper that breaks naive copy-paste of JS
 *   5. Poisons clipboard/copy attempts with a warning string
 *   6. Detects DevTools opening (optional, mild signal only)
 * 
 * Configure BOT_TRAP_ENDPOINT to point to your bot-trap.js server.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN NOTES & ISSUES
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * ⚠️  CLOUDFLARE PAGES:
 *     BOT_TRAP_ENDPOINT='/trap' works — _middleware.js handles /trap/* routes.
 *     No change needed here. Just ensure the middleware is deployed.
 * 
 * ⚠️  FALSE POSITIVE RISK on headless detection:
 *     `navigator.plugins.length === 0` fires on some mobile browsers and
 *     privacy-hardened setups (Firefox resistFingerprinting). The 2-signal
 *     minimum threshold mitigates this — don't lower it below 2.
 * 
 * ⚠️  CLIPBOARD POISONING requires prior user interaction (browser security).
 *     Silent fail otherwise. This is a bonus layer, not primary defence — fine.
 * 
 * ⚠️  `redirectToTrap()` uses window.location.replace() which is VISIBLE to the
 *     bot — it sees the redirect and may note/skip the trap URL.
 *     BETTER APPROACH: use a silent beacon first, keep serving normal content:
 *       fetch('/trap/beacon?src=' + btoa(location.href), {keepalive:true})
 *     Then let _middleware.js handle subsequent requests from that IP.
 *     This way the bot doesn't know it's been flagged.
 * 
 * ℹ️  selfDefend() only catches naive beautifiers that strip function names.
 *     Won't stop a proper AST deobfuscator. Still worth having as a speed bump.
 * 
 * ℹ️  The honeypot links use rel="nofollow" which is correct — tells honest bots
 *     to skip them, while dishonest ones ignore it and get trapped. Good design.
 * 
 * ℹ️  MISSING: no Content Security Policy nonce awareness. If the target page
 *     has a strict CSP, this inline script may be blocked. Ensure CSP allows
 *     the /bot-trap-client.js src origin, or add a nonce via the inject script.
 */

(function() {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────────
  const BOT_TRAP_ENDPOINT = '/trap';   // Your bot-trap.js server trap zone
  const HONEYPOT_PATHS = [
    '/trap/api/harvest',
    '/trap/data/export',
    '/trap/source/download',
    '/trap/js/bundle.js',
    '/trap/admin/config',
    '/trap/api/all-data',
  ];

  // ── HEADLESS BROWSER DETECTION ───────────────────────────────────────────
  function detectHeadless() {
    const signals = [];

    // 1. navigator.webdriver (Selenium/Puppeteer/Playwright)
    if (navigator.webdriver) signals.push('webdriver');

    // 2. Chrome-specific headless tells
    if (window.chrome === undefined && navigator.userAgent.includes('Chrome')) {
      signals.push('no-chrome-object');
    }

    // 3. Missing plugins (headless Chrome has no plugins)
    if (navigator.plugins && navigator.plugins.length === 0) {
      signals.push('no-plugins');
    }

    // 4. Language inconsistency
    if (!navigator.language || navigator.language === '') {
      signals.push('no-language');
    }

    // 5. Screen size tells (PhantomJS default)
    if (screen.width === 1 || screen.height === 1 ||
        screen.width === 0 || screen.height === 0) {
      signals.push('bad-screen');
    }

    // 6. Permissions API trick (headless Chrome returns inconsistent results)
    if (window.Notification && Notification.permission === 'denied' &&
        navigator.plugins.length === 0) {
      signals.push('denied-notif-no-plugins');
    }

    // 7. Function.prototype.toString poisoning check
    // Headless environments sometimes patch native functions
    try {
      const toString = Function.prototype.toString;
      if (toString.toString().indexOf('native code') === -1) {
        signals.push('patched-native');
      }
    } catch(e) {}

    return signals.length >= 2; // require at least 2 signals to avoid false positives
  }

  // ── CLIPBOARD POISONING ──────────────────────────────────────────────────
  // If someone copies JS from your page, this gets appended
  function poisonClipboard() {
    document.addEventListener('copy', function(e) {
      const selection = window.getSelection();
      if (!selection || selection.toString().length < 50) return; // only long copies

      const poisonText = '\n\n/* ⚠️  This code is protected and licensed to qalarc.com.\n' +
                         '   Unauthorized reproduction or use is prohibited.\n' +
                         '   Trace ID: ' + btoa(location.href + '|' + Date.now()) + ' */\n';

      try {
        e.clipboardData.setData('text/plain', selection.toString() + poisonText);
        e.preventDefault();
      } catch(err) {}
    });
  }

  // ── HONEYPOT LINK INJECTION ───────────────────────────────────────────────
  // Invisible links: real users never see/interact with them, scrapers follow them
  function injectHoneypotLinks() {
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = [
      'position:absolute',
      'left:-9999px',
      'top:-9999px',
      'width:1px',
      'height:1px',
      'overflow:hidden',
      'opacity:0',
      'pointer-events:none',
      'user-select:none',
    ].join(';');

    HONEYPOT_PATHS.forEach(function(path) {
      const a = document.createElement('a');
      a.href = path;
      a.rel = 'nofollow';
      a.tabIndex = -1;
      // Random text so it looks like real content to a naive scraper
      a.textContent = _genWord();
      container.appendChild(a);
    });

    // Add robots meta just for the trap pages (not this page)
    // Real robots.txt should Disallow: /trap/

    document.body.appendChild(container);
  }

  // ── REDIRECT DETECTED BOTS ───────────────────────────────────────────────
  function redirectToTrap() {
    // Don't redirect during development
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

    // Send bot to trap entry, carrying encoded origin so trap can log it
    const dest = BOT_TRAP_ENDPOINT + '/entry/' + btoa(location.href).replace(/=/g,'');
    window.location.replace(dest);
  }

  // ── DEVTOOLS DETECTION (mild) ─────────────────────────────────────────────
  // Fires when someone opens devtools — doesn't block, just notes it
  let devtoolsOpen = false;
  function detectDevTools() {
    const threshold = 160;
    const check = function() {
      if (window.outerWidth - window.innerWidth > threshold ||
          window.outerHeight - window.innerHeight > threshold) {
        if (!devtoolsOpen) {
          devtoolsOpen = true;
          // Could log to analytics here — for now just note it
          // console.debug('devtools detected');
        }
      } else {
        devtoolsOpen = false;
      }
    };
    setInterval(check, 1000);
  }

  // ── SELF-DEFENSE: Break naive beautifiers ────────────────────────────────
  // Detects whether this script has been copy-pasted and re-deployed after
  // being run through a JS beautifier. V8 preserves named function source text,
  // so probe.toString() on an untouched script will always contain "probe" and
  // "function". If a beautifier has renamed or restructured the code, the check
  // fires and sets _silenced = true, which quietly no-ops all trap behaviour.
  //
  // Fix: the original code did `console = {...}` which is a TypeError in strict
  // mode. Use a flag variable inside the IIFE closure instead.
  var _silenced = false;

  function selfDefend() {
    var probe = function probe() {};
    var src = probe.toString();
    if (src.indexOf('probe') === -1 || src.indexOf('function') === -1) {
      _silenced = true; // transformed — disable trap behaviour silently
    }
  }

  // ── WORD GENERATOR (for honeypot link text) ───────────────────────────────
  var _pool = ['system','engine','module','handler','controller','parser',
               'router','proxy','cache','session','token','auth','api',
               'service','client','pipeline','stream','worker','scheduler'];
  function _genWord() {
    return _pool[Math.floor(Math.random() * _pool.length)] + '-' +
           _pool[Math.floor(Math.random() * _pool.length)];
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  function init() {
    selfDefend();
    if (_silenced) return; // transformed copy — don't activate

    poisonClipboard();
    detectDevTools();

    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        injectHoneypotLinks();
        if (detectHeadless()) redirectToTrap();
      });
    } else {
      injectHoneypotLinks();
      if (detectHeadless()) redirectToTrap();
    }
  }

  init();

})();
