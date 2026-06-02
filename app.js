/**
 * Embiggen — app.js
 * T1.1: Scaffolding — two-view navigation + text passing foundation.
 * T1.3: Display mode — Anton font, binary-search font sizing, resize handling.
 * T1.4: Zoom-in animation — scale from tiny to full on display entry.
 */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Text entered by the user on the home view. */
let currentText = '';

// ---------------------------------------------------------------------------
// DOM references — resolved after DOMContentLoaded
// ---------------------------------------------------------------------------

let viewHome;
let viewDisplay;
let inputText;
let btnEmbiggen;
let displayText;

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

  showView(viewDisplay);

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

  // Guard: abort with a clear error if any expected element is missing.
  const missing = [
    ['view-home',     viewHome],
    ['view-display',  viewDisplay],
    ['input-text',    inputText],
    ['btn-embiggen',  btnEmbiggen],
    ['display-text',  displayText],
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
});
