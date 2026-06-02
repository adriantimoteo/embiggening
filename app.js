/**
 * Embiggen — app.js
 * T1.1: Scaffolding — two-view navigation + text passing foundation.
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

  // Handle browser back button while in display view.
  window.addEventListener('popstate', () => {
    // When the user presses back from display view, history.state will no
    // longer be { view: 'display' }, so we simply return to home.
    navigateToHome();
  });

  // Start on home view (the CSS default; this call is defensive).
  showView(viewHome);
});
