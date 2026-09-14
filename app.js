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
  // Wait for Anton to be fully loaded before drawing, so measureText() and
  // the actual glyph outlines are both based on the real font metrics.
  await document.fonts.ready;

  const dpr    = window.devicePixelRatio || 1;
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;

  // Read the exact font-size string that fitTextToDisplay() computed,
  // e.g. "142px". parseInt extracts the numeric pixel value.
  const fontSizeStr = displayText.style.fontSize; // e.g. "142px"
  const fontSizePx  = parseInt(fontSizeStr, 10);

  // Determine colours from the system colour-scheme preference.
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const bgColour   = isDark ? '#000000' : '#ffffff';
  const textColour = isDark ? '#ffffff' : '#000000';

  // Create an off-screen canvas at physical pixel dimensions.
  const canvas = document.createElement('canvas');
  canvas.width  = vw * dpr;
  canvas.height = vh * dpr;

  const ctx = canvas.getContext('2d');

  // Scale the context so all subsequent drawing coordinates are in CSS pixels.
  ctx.scale(dpr, dpr);

  // Fill background.
  ctx.fillStyle = bgColour;
  ctx.fillRect(0, 0, vw, vh);

  // Configure the font — must match the CSS font stack used in #display-text.
  ctx.font = `${fontSizeStr} Anton`;

  // ---------------------------------------------------------------------------
  // Manual word wrapping — CSS wraps automatically; canvas does not.
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Text positioning — vertically and horizontally centred.
  // ---------------------------------------------------------------------------

  const lineHeight    = fontSizePx * 1.15;
  const totalBlockH   = lines.length * lineHeight;
  const startY        = (vh - totalBlockH) / 2;

  ctx.fillStyle  = textColour;
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'top';

  lines.forEach((line, i) => {
    ctx.fillText(line, vw / 2, startY + i * lineHeight);
  });

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

  displayText.textContent = currentText;
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
  playZoomAnimation();

  // Re-size once Anton is confirmed loaded (guards against font-display:swap
  // causing a mis-size on first visit before the woff2 has been cached).
  // If a resize is needed we replay the animation so the final state matches.
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

  // Guard: abort with a clear error if any expected element is missing.
  const missing = [
    ['view-home',     viewHome],
    ['view-display',  viewDisplay],
    ['input-text',    inputText],
    ['btn-embiggen',  btnEmbiggen],
    ['display-text',  displayText],
    ['btn-share',     btnShare],
  ].filter(([, el]) => !el).map(([id]) => id);

  if (missing.length) {
    console.error('Embiggen: missing DOM elements:', missing.join(', '));
    return;
  }

  // Wire up the Embiggen button.
  btnEmbiggen.addEventListener('click', navigateToDisplay);

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

  viewDisplay.addEventListener('click', playZoomAnimation);

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
