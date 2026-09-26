/**
 * Embiggen — app.js
 * T1.1: Scaffolding — two-view navigation + text passing foundation.
 * T1.3: Display mode — Anton font, binary-search font sizing, resize handling.
 * T1.4: Zoom-in animation — scale from tiny to full on display entry.
 * T1.5: Navigation — back clears textarea, tap replays animation, long-press stub.
 * T2.1: Screen Wake Lock — keeps the screen on while in display mode.
 * T2.2: Canvas image generation — generateShareImage() returns a PNG Blob.
 * T2.3: Share — triggers Web Share API (or download fallback) via the share button.
 * T3.3: Mobile UX polish — blur keyboard before entering display mode.
 * T4.1: Nothing OS theme — Ndot font swap via a discreet home-screen toggle.
 * T4.2: Airport split-flap theme — tile grid, flip animation, 3-dot select.
 */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Text entered by the user on the home view. */
let currentText = '';

/**
 * The active WakeLockSentinel, or null when no wake lock is held.
 * Browsers automatically release the sentinel when the page is hidden;
 * we re-acquire it on visibilitychange (see DOMContentLoaded below).
 * @type {WakeLockSentinel|null}
 */
let wakeLockSentinel = null;

// ---------------------------------------------------------------------------
// DOM references — resolved after DOMContentLoaded
// ---------------------------------------------------------------------------

let viewHome;
let viewDisplay;
let inputText;
let btnEmbiggen;
let displayText;
let btnShare;
let themeDots;

// ---------------------------------------------------------------------------
// Theme selection (T4.1, extended to 3 themes in T4.2)
// ---------------------------------------------------------------------------

const THEME_STORAGE_KEY = 'embiggen-theme';
const THEMES = ['default', 'nothing', 'airport'];
const NOTHING_FONT = "'NDOT 45 (inspired by NOTHING)'";
const AIRPORT_FONT = "'Archivo Black'";

/** The active theme name. Kept in sync with document.body.dataset.theme. */
let currentTheme = 'default';

/** Apply a theme by name, update the dot selector, and persist the choice. */
function applyTheme(name) {
  currentTheme = THEMES.includes(name) ? name : 'default';

  if (currentTheme === 'default') {
    delete document.body.dataset.theme;
  } else {
    document.body.dataset.theme = currentTheme;
  }

  themeDots.forEach((dot) => {
    dot.classList.toggle('active', dot.dataset.theme === currentTheme);
  });

  try {
    localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  } catch (_err) {
    // Storage unavailable (private browsing, disabled storage) — theme still
    // applies for this session, just won't persist across reloads.
  }
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

/**
 * Show exactly one view by toggling the "active" class.
 * @param {HTMLElement} viewToShow
 */
function showView(viewToShow) {
  [viewHome, viewDisplay].forEach((view) => {
    view.classList.toggle('active', view === viewToShow);
  });
}

// ---------------------------------------------------------------------------
// Display mode — font sizing
// ---------------------------------------------------------------------------

/**
 * Use binary search to find the largest font-size (in px) at which the text
 * fits inside #display-text without overflowing either dimension.
 *
 * The element must be visible (in the active view) before calling this so
 * that scrollHeight / scrollWidth measurements are accurate.
 */
function fitTextToDisplay() {
  const MIN_SIZE = 1;
  const MAX_SIZE = 500;
  const PRECISION = 1; // Stop when high - low <= 1px

  let low = MIN_SIZE;
  let high = MAX_SIZE;

  while (high - low > PRECISION) {
    const mid = Math.floor((low + high) / 2);
    displayText.style.fontSize = mid + 'px';

    const overflows =
      displayText.scrollHeight > displayText.clientHeight ||
      displayText.scrollWidth  > displayText.clientWidth;

    if (overflows) {
      high = mid; // Too big — try smaller
    } else {
      low = mid;  // Fits — try bigger
    }
  }

  // Settle on the last known-good (fitting) size.
  displayText.style.fontSize = low + 'px';
}

// ---------------------------------------------------------------------------
// Airport split-flap theme — tiles + flip animation (T4.2)
// ---------------------------------------------------------------------------

/** Characters a tile flickers through before landing on its real character. */
const FLAP_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FLAP_STEP_MS = 90;
const FLAP_STAGGER_MS = 15;
const FLAP_MIN_STEPS = 8;
const FLAP_MAX_STEPS = 18;

function randomFlapChar() {
  return FLAP_CHARSET[Math.floor(Math.random() * FLAP_CHARSET.length)];
}

/**
 * Replace #display-text's contents with one .flap-tile per character of
 * `text` (uppercased — split-flap tiles are conventionally caps-only; this
 * is a display-only transform, currentText itself keeps its original case).
 * A space becomes a blank tile so word gaps still occupy a grid column,
 * matching a real fixed-column board.
 */
function buildFlapTiles(text) {
  displayText.innerHTML = '';
  for (const char of text.toUpperCase()) {
    const tile = document.createElement('span');
    tile.className = 'flap-tile';
    tile.dataset.char = char;

    const face = document.createElement('span');
    face.className = 'flap-tile-face';
    face.textContent = char === ' ' ? '' : char;

    tile.appendChild(face);
    displayText.appendChild(tile);
  }
}

/**
 * Run a tile through a few random-character "flicker" steps before landing
 * on its real character. Each step re-triggers the flap-flip CSS animation
 * (remove/reflow/re-add, same trick playZoomAnimation uses) and swaps the
 * face's textContent at the animation's squash midpoint so the character
 * change happens while the tile is edge-on, selling the flip illusion.
 */
function flipTile(tile, delay) {
  const face = tile.querySelector('.flap-tile-face');
  const finalChar = tile.dataset.char;
  const steps = FLAP_MIN_STEPS + Math.floor(Math.random() * (FLAP_MAX_STEPS - FLAP_MIN_STEPS + 1));
  let step = 0;

  function runStep() {
    const isLast = step === steps - 1;
    const char = isLast ? finalChar : randomFlapChar();

    tile.classList.remove('flapping');
    // Force reflow so the animation restarts cleanly on every step.
    // eslint-disable-next-line no-unused-expressions
    tile.offsetWidth; // jshint ignore:line
    tile.classList.add('flapping');

    setTimeout(() => {
      face.textContent = char === ' ' ? '' : char;
    }, FLAP_STEP_MS / 2);

    step++;
    if (step < steps) {
      setTimeout(runStep, FLAP_STEP_MS);
    }
  }

  setTimeout(runStep, delay);
}

/** Kick off a staggered flip sequence across every tile in #display-text. */
function playFlapAnimation() {
  // A .zoom-in left over from a Default/Nothing run would replay whenever
  // the display view goes display:none → shown, scaling the board (T4.4).
  displayText.classList.remove('zoom-in');

  const tiles = displayText.querySelectorAll('.flap-tile');
  tiles.forEach((tile, i) => flipTile(tile, i * FLAP_STAGGER_MS));
}

/**
 * Read the live tile grid back out of the DOM, grouped into rows by their
 * rendered vertical position. Used by generateShareImage() so the shared
 * image matches the actual on-screen wrap exactly, rather than recomputing
 * (and potentially mismatching) the wrap independently.
 * @returns {string[][]} Rows of characters, in display order.
 */
function readFlapRows() {
  const tiles = Array.from(displayText.querySelectorAll('.flap-tile'));
  const rows = [];
  let lastTop = null;

  for (const tile of tiles) {
    const top = Math.round(tile.offsetTop);
    if (top !== lastTop) {
      rows.push([]);
      lastTop = top;
    }
    rows[rows.length - 1].push(tile.dataset.char);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Canvas image generation (T2.2)
// ---------------------------------------------------------------------------

/**
 * Render the current embiggened text to a canvas and return a PNG Blob.
 *
 * The output exactly matches what the user sees on screen:
 *   - Same Anton font at the same px size calculated by fitTextToDisplay()
 *   - Same background and text colours (dark/light mode aware)
 *   - Same manual word-wrap layout, horizontally and vertically centred
 *   - Scaled by devicePixelRatio for crisp output on retina/HiDPI screens
 *
 * @returns {Promise<Blob>} A Promise that resolves to a PNG image Blob.
 */
async function generateShareImage() {
  // Wait for fonts to be fully loaded before drawing, so measureText() and
  // the actual glyph outlines are both based on the real font metrics.
  await document.fonts.ready;

  const dpr    = window.devicePixelRatio || 1;
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;

  // Read the exact font-size string that fitTextToDisplay() computed,
  // e.g. "142px". parseInt extracts the numeric pixel value.
  const fontSizeStr = displayText.style.fontSize; // e.g. "142px"
  const fontSizePx  = parseInt(fontSizeStr, 10);

  // Create an off-screen canvas at physical pixel dimensions.
  const canvas = document.createElement('canvas');
  canvas.width  = vw * dpr;
  canvas.height = vh * dpr;

  const ctx = canvas.getContext('2d');

  // Scale the context so all subsequent drawing coordinates are in CSS pixels.
  ctx.scale(dpr, dpr);

  if (currentTheme === 'airport') {
    drawFlapBoard(ctx, vw, vh, fontSizePx);
  } else {
    drawTextBlock(ctx, vw, vh, fontSizeStr, fontSizePx);
  }

  // ---------------------------------------------------------------------------
  // Output — convert the canvas to a PNG Blob via a Promise wrapper.
  // ---------------------------------------------------------------------------

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('canvas.toBlob() returned null'));
      }
    }, 'image/png');
  });
}

/**
 * Draw the Default/Nothing themes' single word-wrapped text block. CSS wraps
 * automatically for the live display; canvas does not, so word-wrapping is
 * reproduced manually here to match.
 */
function drawTextBlock(ctx, vw, vh, fontSizeStr, fontSizePx) {
  // Determine colours from the system colour-scheme preference.
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const bgColour   = isDark ? '#000000' : '#ffffff';
  const textColour = isDark ? '#ffffff' : '#000000';

  ctx.fillStyle = bgColour;
  ctx.fillRect(0, 0, vw, vh);

  // Configure the font — must match the CSS font stack used in #display-text.
  const fontFamily = currentTheme === 'nothing' ? NOTHING_FONT : 'Anton';
  ctx.font = `${fontSizeStr} ${fontFamily}`;

  const words      = currentText.split(' ');
  const lines      = [];
  let   currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const { width } = ctx.measureText(candidate);

    if (width <= vw) {
      // Word fits on the current line — append it.
      currentLine = candidate;
    } else {
      // Word doesn't fit.
      if (currentLine) {
        // Flush the current line and start a new one with this word.
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single word wider than the canvas — place it on its own line.
        lines.push(word);
        currentLine = '';
      }
    }
  }

  // Push any remaining text as the final line.
  if (currentLine) {
    lines.push(currentLine);
  }

  const lineHeight    = fontSizePx * 1.15;
  const totalBlockH   = lines.length * lineHeight;
  const startY        = (vh - totalBlockH) / 2;

  ctx.fillStyle  = textColour;
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'top';

  lines.forEach((line, i) => {
    ctx.fillText(line, vw / 2, startY + i * lineHeight);
  });
}

/**
 * Draw the airport theme's tile grid, reading actual row breaks back out of
 * the live DOM (readFlapRows()) so the image matches the on-screen
 * fixed-column wrap exactly rather than recomputing it independently.
 * Tile geometry (0.85em wide, 1em tall, 0.03em margin) mirrors the
 * .flap-tile CSS rules in style.css.
 */
function drawFlapBoard(ctx, vw, vh, fontSizePx) {
  const BOARD_BG = '#0a0a0a';
  const TILE_BG  = '#161616';
  const TEXT_COLOUR = '#e8e4d8';
  const DIVIDER_COLOUR = 'rgba(0, 0, 0, 0.55)';

  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, vw, vh);

  const rows = readFlapRows();

  const margin   = fontSizePx * 0.03;
  const tileW    = fontSizePx * 0.85 + margin * 2;
  const tileH    = fontSizePx * 1 + margin * 2;
  const totalH   = rows.length * tileH;
  const startY   = (vh - totalH) / 2;

  ctx.font = `${fontSizePx}px ${AIRPORT_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rows.forEach((row, r) => {
    const rowW    = row.length * tileW;
    const startX  = (vw - rowW) / 2;
    const cy      = startY + r * tileH + tileH / 2;

    row.forEach((char, c) => {
      const cx = startX + c * tileW + tileW / 2;
      const left = cx - tileW / 2 + margin;
      const top  = cy - tileH / 2 + margin;
      const w    = tileW - margin * 2;
      const h    = tileH - margin * 2;

      ctx.fillStyle = TILE_BG;
      ctx.fillRect(left, top, w, h);

      ctx.strokeStyle = DIVIDER_COLOUR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, cy);
      ctx.lineTo(left + w, cy);
      ctx.stroke();

      if (char !== ' ') {
        ctx.fillStyle = TEXT_COLOUR;
        ctx.fillText(char, cx, cy);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Share (T2.3)
// ---------------------------------------------------------------------------

/**
 * Generate a PNG image of the current display and share it via the Web Share
 * API. Falls back to a direct download if the API is unavailable or does not
 * support file sharing.
 *
 * Called from the share button's click handler.
 */
async function triggerShare() {
  let blob;
  try {
    blob = await generateShareImage();
  } catch (_err) {
    // Image generation failed — nothing useful to share.
    return;
  }

  const file = new File([blob], 'embiggen.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'AbortError') {
        // User dismissed the share sheet — expected, ignore silently.
        return;
      }
      // Any other share error — fail silently.
    }
  } else {
    // Web Share API unavailable or file sharing not supported — download fallback.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'embiggen.png';
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Display mode — animation
// ---------------------------------------------------------------------------

/**
 * Replay the zoom-in animation on #display-text.
 *
 * The trick: removing the class, forcing a style recalculation (by reading
 * offsetWidth), then re-adding it causes the browser to restart the animation
 * from scratch. T1.5 calls this directly to replay on tap.
 */
function playZoomAnimation() {
  displayText.classList.remove('zoom-in');
  // Force reflow so the browser registers the class removal before we re-add.
  // eslint-disable-next-line no-unused-expressions
  displayText.offsetWidth; // jshint ignore:line
  displayText.classList.add('zoom-in');
}

/**
 * Play whichever entrance animation matches the active theme — the flap
 * animation replaces the zoom-in entirely for the airport theme rather than
 * layering on top of it (T4.2).
 */
function playEntranceAnimation() {
  if (currentTheme === 'airport') {
    playFlapAnimation();
  } else {
    playZoomAnimation();
  }
}

// ---------------------------------------------------------------------------
// Screen Wake Lock (T2.1)
// ---------------------------------------------------------------------------

/**
 * Request a screen wake lock and store the sentinel.
 * Silent no-op if the API is unsupported or the request is denied.
 */
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
  } catch (_err) {
    // Permission denied or API unavailable — continue without wake lock.
  }
}

/**
 * Release the active wake lock sentinel, if any.
 * Silent no-op if none is held or the release fails.
 */
async function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch (_err) {
    // Release failed — nothing useful we can do.
  } finally {
    wakeLockSentinel = null;
  }
}

/** Navigate from home → display. */
function navigateToDisplay() {
  currentText = inputText.value.trim();

  if (!currentText) {
    // Nothing to display — do nothing (future tickets may add validation UI).
    return;
  }

  // Push a new history entry so the browser back button can return to home.
  history.pushState({ view: 'display' }, '', '');

  if (currentTheme === 'airport') {
    buildFlapTiles(currentText);
  } else {
    displayText.innerHTML = '';
    displayText.textContent = currentText;
  }
  console.log('Embiggen: text passed to display →', currentText);

  // Dismiss the on-screen keyboard before the display view appears so it
  // doesn't linger over the embiggened text on mobile (T3.3).
  inputText.blur();

  showView(viewDisplay);
  acquireWakeLock();

  // fitTextToDisplay() must run before the animation so the font size is
  // already correct at the start of the scale — the animation only transforms
  // the already-sized element, it never changes font-size.
  fitTextToDisplay();
  playEntranceAnimation();

  // Re-size once the display font is confirmed loaded (guards against
  // font-display:swap causing a mis-size on first visit before the woff2 has
  // been cached). If a resize is needed we replay the animation so the final
  // state matches.
  document.fonts.ready.then(() => {
    if (viewDisplay.classList.contains('active')) {
      fitTextToDisplay();
    }
  });
}

/** Navigate from display → home (no new history entry needed). */
function navigateToHome() {
  releaseWakeLock();
  // Clear the textarea so the user starts fresh for their next message.
  inputText.value = '';
  showView(viewHome);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Resolve DOM references.
  viewHome    = document.getElementById('view-home');
  viewDisplay = document.getElementById('view-display');
  inputText   = document.getElementById('input-text');
  btnEmbiggen = document.getElementById('btn-embiggen');
  displayText = document.getElementById('display-text');
  btnShare    = document.getElementById('btn-share');
  themeDots   = document.querySelectorAll('.theme-dot');

  // Guard: abort with a clear error if any expected element is missing.
  const missing = [
    ['view-home',     viewHome],
    ['view-display',  viewDisplay],
    ['input-text',    inputText],
    ['btn-embiggen',  btnEmbiggen],
    ['display-text',  displayText],
    ['btn-share',     btnShare],
    ['theme-select',  themeDots.length === THEMES.length ? themeDots : null],
  ].filter(([, el]) => !el).map(([id]) => id);

  if (missing.length) {
    console.error('Embiggen: missing DOM elements:', missing.join(', '));
    return;
  }

  // Wire up the Embiggen button.
  btnEmbiggen.addEventListener('click', navigateToDisplay);

  // Restore the theme preference, if any (T4.1, T4.2).
  let storedTheme;
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (_err) {
    storedTheme = null;
  }
  applyTheme(storedTheme || 'default');

  // Preload the airport font so the first fit uses real font metrics rather
  // than fallback ones that would resize the board once the font arrives
  // (T4.4). Failure is harmless — fit just re-runs on fonts.ready as before.
  document.fonts.load(`1em ${AIRPORT_FONT}`).catch(() => {});

  themeDots.forEach((dot) => {
    dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
  });

  // Enter (without Shift) on the textarea triggers Embiggen, matching the
  // button click. Shift+Enter inserts a newline as normal.
  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      navigateToDisplay();
    }
  });

  // Handle browser back button while in display view.
  window.addEventListener('popstate', () => {
    // When the user presses back from display view, history.state will no
    // longer be { view: 'display' }, so we simply return to home.
    navigateToHome();
  });

  // -------------------------------------------------------------------------
  // Display view interactions (A1.6)
  //
  // Tap anywhere on the display → replay zoom animation.
  // Share button (bottom-right) → generate image and open share sheet.
  // stopPropagation on the button prevents the tap-animation from also firing.
  // -------------------------------------------------------------------------

  viewDisplay.addEventListener('click', playEntranceAnimation);

  btnShare.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerShare();
  });

  // -------------------------------------------------------------------------
  // Wake lock re-acquisition on foreground (T2.1)
  //
  // The browser automatically releases the sentinel when the page is hidden.
  // Re-acquire it when the page becomes visible again, but only while the
  // display view is still active.
  // -------------------------------------------------------------------------

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && viewDisplay.classList.contains('active')) {
      acquireWakeLock();
    }
  });

  // Recalculate font size on viewport changes (rotation, resize).
  function handleResize() {
    // Only recalculate when the display view is active.
    if (viewDisplay.classList.contains('active')) {
      fitTextToDisplay();
    }
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  // Start on home view (the CSS default; this call is defensive).
  showView(viewHome);

  // -------------------------------------------------------------------------
  // Service Worker registration (T3.2)
  //
  // Registers sw.js to enable offline support via Cache API.
  // The guard prevents errors in browsers that don't support service workers
  // (e.g. some older WebViews, file:// origins).
  // -------------------------------------------------------------------------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
