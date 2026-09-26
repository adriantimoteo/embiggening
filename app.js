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
 * T5.1: Per-line layout for Default/Nothing — word-boundary lines, one size per line.
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
const AIRPORT_FONT = "'Barlow Condensed'";

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
// Default/Nothing per-line layout (T5.1)
//
// Text is broken between words (or groups of words) wherever possible. Each
// line gets its own font size so it fills the display width. Every grouping
// of words into lines is scored by the screen area it fills, and the best is
// used. A word is only split mid-word when the best whole-word layout is
// unreadably small (smallest line under SPLIT_BELOW_FRACTION of the shorter
// screen side) AND splitting makes its smallest line at least SPLIT_MIN_GAIN
// times bigger (T5.2) — so words that fit stay whole, like the airport theme.
//
// Everything from here to renderLineLayout() is pure (no DOM): measure(str)
// returns the width of str in em, so the same layout can drive the live
// display and the share image.
// ---------------------------------------------------------------------------

/** Line box height as a multiple of the line's font size. */
const LINE_HEIGHT = 1.05;
/** Fraction of the display width a line is sized to fill (small safety margin). */
const FILL_WIDTH = 0.97;
/** Fraction of the display height the stack of lines may occupy. */
const FILL_HEIGHT = 0.94;
/** No line may be more than this many times the size of the smallest line. */
const MAX_CONTRAST = 2.5;
/** Split only if the whole-word layout's smallest line is under this fraction of min(W, H). */
const SPLIT_BELOW_FRACTION = 0.08;
/** ...and the split layout's smallest line is at least this many times bigger. */
const SPLIT_MIN_GAIN = 1.5;
/** Minimum characters in each piece of a split word (avoids orphan letters). */
const MIN_SPLIT_PIECE = 2;
/** Only the widest few words are considered for splitting (bounds the search). */
const MAX_SPLITTABLE_WORDS = 3;
/** Above this many optional line-break positions, use the greedy fallback. */
const MAX_OPTIONAL_BREAKS = 11;

/** Font-family used for the Default/Nothing display, in CSS/canvas syntax. */
function displayFontFamily() {
  return currentTheme === 'nothing' ? `${NOTHING_FONT}, 'Anton', sans-serif` : "'Anton', sans-serif";
}

/** Build a measure(str) → width-in-em function (cached) for a font family. */
function makeMeasure(family) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `100px ${family}`;
  const cache = new Map();
  return (str) => {
    let w = cache.get(str);
    if (w === undefined) {
      w = ctx.measureText(str).width / 100;
      cache.set(str, w);
    }
    return w;
  };
}

/**
 * Split text into words. Typed newlines become forced line breaks
 * (breakBefore on the first word of each later line); blank lines are dropped.
 */
function parseWords(text) {
  const words = [];
  text.split('\n').forEach((line) => {
    line.split(/\s+/).filter(Boolean).forEach((w, i) => {
      words.push({ text: w, breakBefore: i === 0 && words.length > 0 });
    });
  });
  return words;
}

/**
 * Turn words into line-break tokens, replacing any word that has an entry in
 * `pieces` with its pieces. Each piece sits on its own line, so a split word
 * forces a break before it and before whatever follows it.
 */
function buildTokens(words, pieces) {
  const tokens = [];
  let forceNext = false;
  words.forEach((word, i) => {
    if (pieces[i]) {
      pieces[i].forEach((p) => tokens.push({ text: p, breakBefore: true }));
      forceNext = true;
    } else {
      tokens.push({ text: word.text, breakBefore: word.breakBefore || forceNext });
      forceNext = false;
    }
  });
  return tokens;
}

/**
 * Size a set of lines: each fills the width, capped at MAX_CONTRAST times the
 * smallest, then all scaled down uniformly if the stack is taller than H.
 * `area` is the total line-box area covered, used to compare layouts.
 */
function sizeLines(lineTexts, W, H, measure) {
  const usableW = W * FILL_WIDTH;
  const widths = lineTexts.map((t) => Math.max(measure(t), 0.05));
  let sizes = widths.map((w) => usableW / w);

  const cap = Math.min(...sizes) * MAX_CONTRAST;
  sizes = sizes.map((s) => Math.min(s, cap));

  const totalH = sizes.reduce((sum, s) => sum + s * LINE_HEIGHT, 0);
  const scale = Math.min(1, (H * FILL_HEIGHT) / totalH);
  sizes = sizes.map((s) => s * scale);

  let area = 0;
  sizes.forEach((s, i) => { area += (s * widths[i]) * (s * LINE_HEIGHT); });

  return {
    lines: lineTexts.map((text, i) => ({ text, fontSize: sizes[i] })),
    area,
    minSize: Math.min(...sizes),
  };
}

/** Try every grouping of tokens into lines; return the best-scoring layout. */
function exhaustiveGrouping(tokens, W, H, measure) {
  const optional = [];
  for (let i = 1; i < tokens.length; i++) {
    if (!tokens[i].breakBefore) optional.push(i);
  }

  let best = null;
  for (let mask = 0; mask < (1 << optional.length); mask++) {
    const breaks = new Set(optional.filter((_, bit) => mask & (1 << bit)));
    const lineTexts = [];
    let current = tokens[0].text;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].breakBefore || breaks.has(i)) {
        lineTexts.push(current);
        current = tokens[i].text;
      } else {
        current += ' ' + tokens[i].text;
      }
    }
    lineTexts.push(current);

    // Strict > keeps the first (fewest-lines) grouping on ties.
    const result = sizeLines(lineTexts, W, H, measure);
    if (!best || result.area > best.area) best = result;
  }
  return best;
}

/**
 * Fallback for long text (too many groupings to try): greedily word-wrap at
 * the largest uniform size that fits the height without splitting any word,
 * then size each resulting line to fill the width.
 */
function greedyGrouping(tokens, W, H, measure) {
  const usableW = W * FILL_WIDTH;
  const maxWordEm = Math.max(...tokens.map((t) => Math.max(measure(t.text), 0.05)));

  function wrap(size) {
    const lines = [];
    let current = tokens[0].text;
    for (let i = 1; i < tokens.length; i++) {
      const candidate = current + ' ' + tokens[i].text;
      if (tokens[i].breakBefore || measure(candidate) * size > usableW) {
        lines.push(current);
        current = tokens[i].text;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines;
  }

  let low = 1;
  let high = Math.min(500, usableW / maxWordEm);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (wrap(mid).length * mid * LINE_HEIGHT > H * FILL_HEIGHT) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return sizeLines(wrap(low), W, H, measure);
}

function solveTokens(tokens, W, H, measure) {
  const optionalBreaks = tokens.filter((t, i) => i > 0 && !t.breakBefore).length;
  return optionalBreaks <= MAX_OPTIONAL_BREAKS
    ? exhaustiveGrouping(tokens, W, H, measure)
    : greedyGrouping(tokens, W, H, measure);
}

/**
 * Balanced ways to cut a word into pieces of ≥ MIN_SPLIT_PIECE chars: the best
 * 2-piece cut and, for long words, the best 3-piece cut (minimising the widest
 * piece, using cumulative prefix widths).
 */
function splitCandidates(word, measure) {
  const chars = Array.from(word);
  const len = chars.length;
  const min = MIN_SPLIT_PIECE;
  if (len < min * 2) return [];

  const pref = [0];
  for (let i = 1; i <= len; i++) pref.push(measure(chars.slice(0, i).join('')));
  const join = (a, b) => chars.slice(a, b).join('');

  const out = [];

  let bestI = -1;
  let bestW = Infinity;
  for (let i = min; i <= len - min; i++) {
    const w = Math.max(pref[i], pref[len] - pref[i]);
    if (w < bestW) { bestW = w; bestI = i; }
  }
  out.push([join(0, bestI), join(bestI, len)]);

  if (len >= min * 3 + 3) {
    let bi = -1;
    let bj = -1;
    bestW = Infinity;
    for (let i = min; i <= len - 2 * min; i++) {
      for (let j = i + min; j <= len - min; j++) {
        const w = Math.max(pref[i], pref[j] - pref[i], pref[len] - pref[j]);
        if (w < bestW) { bestW = w; bi = i; bj = j; }
      }
    }
    out.push([join(0, bi), join(bi, bj), join(bj, len)]);
  }

  return out;
}

/**
 * Compute the per-line layout for `text` in a W×H area.
 * @returns {{lines: {text: string, fontSize: number}[], area: number}}
 */
function computeLineLayout(text, W, H, measure) {
  const words = parseWords(text);
  if (!words.length) return { lines: [], area: 0 };

  const whole = solveTokens(buildTokens(words, []), W, H, measure);

  // Readable as it is — never split (T5.2).
  if (whole.minSize >= Math.min(W, H) * SPLIT_BELOW_FRACTION) return whole;

  // Words worth trying to split: the widest few that are long enough.
  const options = new Map();
  words
    .map((word, i) => ({ i, width: measure(word.text) }))
    .filter(({ i }) => Array.from(words[i].text).length >= MIN_SPLIT_PIECE * 2)
    .sort((a, b) => b.width - a.width)
    .slice(0, MAX_SPLITTABLE_WORDS)
    .forEach(({ i }) => options.set(i, splitCandidates(words[i].text, measure)));

  // Every combination of {whole, each split option} across those words,
  // except the all-whole one already solved above.
  const indices = Array.from(options.keys());
  let variants = [[]];
  indices.forEach((wordIdx) => {
    const next = [];
    variants.forEach((v) => {
      next.push(v);
      options.get(wordIdx).forEach((pieces) => next.push([...v, [wordIdx, pieces]]));
    });
    variants = next;
  });

  let bestSplit = null;
  variants.filter((v) => v.length > 0).forEach((v) => {
    const pieces = [];
    v.forEach(([wordIdx, p]) => { pieces[wordIdx] = p; });
    const tokens = buildTokens(words, pieces);
    const optionalBreaks = tokens.filter((t, i) => i > 0 && !t.breakBefore).length;
    if (optionalBreaks > MAX_OPTIONAL_BREAKS) return;
    const result = exhaustiveGrouping(tokens, W, H, measure);
    // Only layouts whose smallest line is much bigger than the whole-word
    // layout's qualify; among those, the one filling the most area wins.
    if (result.minSize < whole.minSize * SPLIT_MIN_GAIN) return;
    if (!bestSplit || result.area > bestSplit.area) bestSplit = result;
  });

  return bestSplit || whole;
}

/** The layout currently on screen; the share image draws exactly this. */
let currentLayout = null;

/** Lay out and render currentText as one element per line (Default/Nothing). */
function renderLineLayout() {
  const W = displayText.clientWidth;
  const H = displayText.clientHeight;
  if (!W || !H) return;

  currentLayout = computeLineLayout(currentText, W, H, makeMeasure(displayFontFamily()));

  displayText.replaceChildren(...currentLayout.lines.map((line) => {
    const el = document.createElement('div');
    el.className = 'display-line';
    el.style.fontSize = line.fontSize + 'px';
    el.style.lineHeight = String(LINE_HEIGHT);
    el.textContent = line.text;
    return el;
  }));
}

/** Size/lay out the display for the active theme. Display view must be visible. */
function fitDisplay() {
  if (currentTheme === 'airport') {
    fitFlapBoard();
  } else {
    renderLineLayout();
  }
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
 * Tile geometry in em, mirroring the .flap-tile / .flap-tile-face CSS rules:
 * a 0.72em-wide, 1em-tall tile with a 0.03em margin on every side, and a
 * glyph scaled 1.2x and nudged up 0.05 (of its own size). Shared by the row
 * layout and the share image (T4.5, T4.6).
 */
const FLAP_TILE_WIDTH_EM = 0.72;
const FLAP_TILE_HEIGHT_EM = 1;
const FLAP_TILE_MARGIN_EM = 0.03;
const FLAP_FACE_SCALE = 1.2;
const FLAP_FACE_NUDGE_EM = -0.05;
const FLAP_TILE_W_EM = FLAP_TILE_WIDTH_EM + FLAP_TILE_MARGIN_EM * 2;
const FLAP_TILE_H_EM = FLAP_TILE_HEIGHT_EM + FLAP_TILE_MARGIN_EM * 2;

/**
 * A word is cut mid-word only if that lets tiles be at least this many times
 * bigger than the biggest layout that keeps every word whole (T4.5).
 */
const FLAP_SPLIT_GAIN = 4;

/**
 * Word-wrap text into rows of at most `cols` tiles (T4.5). Rows break only
 * at word boundaries: words are separated by one blank tile within a row, and
 * a row never starts or ends with a blank. A word wider than a whole row is
 * the last resort and is cut into full-width chunks. Typed newlines force a
 * row break. Text is uppercased — split-flap tiles are conventionally
 * caps-only; currentText itself keeps its original case.
 * @returns {string[][]} Rows of characters (' ' = blank tile).
 */
function layoutFlapRows(text, cols) {
  const rows = [];

  text.toUpperCase().split('\n').forEach((line) => {
    let row = [];
    line.split(/\s+/).filter(Boolean).forEach((word) => {
      let chars = Array.from(word);

      if (row.length && row.length + 1 + chars.length <= cols) {
        row.push(' ', ...chars);
        return;
      }
      if (row.length) {
        rows.push(row);
        row = [];
      }
      while (chars.length > cols) {
        rows.push(chars.slice(0, cols));
        chars = chars.slice(cols);
      }
      row = chars;
    });
    if (row.length) rows.push(row);
  });

  return rows;
}

/** Signature of what is currently built into #display-text (see fitFlapBoard). */
let flapBoardKey = '';

/**
 * Find the largest tile size at which the word-wrapped board fits the display,
 * set it as #display-text's font-size, and build the tile rows (T4.5).
 * Replaces the old DOM-overflow binary search: the layout is computed from
 * the fixed tile geometry, so it doesn't depend on the browser's own wrapping.
 *
 * The rebuild is skipped when neither size nor rows changed, so a late
 * fonts.ready re-fit can't wipe out a flip animation already in progress.
 */
function fitFlapBoard() {
  const W = displayText.clientWidth;
  const H = displayText.clientHeight;
  if (!W || !H) return;

  // Rows for a given tile size, or null if the board doesn't fit or the row
  // is narrower than minCols tiles.
  const layoutAt = (size, minCols) => {
    const cols = Math.floor(W / (FLAP_TILE_W_EM * size));
    if (cols < minCols) return null;
    const rows = layoutFlapRows(currentText, cols);
    return rows.length * FLAP_TILE_H_EM * size <= H ? rows : null;
  };

  // Largest whole-pixel size that fits under those constraints (0 if none).
  const largestSize = (minCols) => {
    let lo = 0;
    let hi = 501;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (layoutAt(mid, minCols)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  // Prefer whole words: only cut a word when keeping every word whole would
  // make the tiles less than 1/FLAP_SPLIT_GAIN as big as cutting allows.
  const longestWord = Math.max(...currentText.split(/\s+/).map((w) => Array.from(w).length));
  const anySize   = largestSize(1);
  const wholeSize = largestSize(longestWord);
  const size = wholeSize && anySize < wholeSize * FLAP_SPLIT_GAIN ? wholeSize : Math.max(anySize, 1);

  const cols = Math.max(1, Math.floor(W / (FLAP_TILE_W_EM * size)));
  const rows = layoutFlapRows(currentText, cols);
  const key = size + '|' + rows.map((r) => r.join('')).join('/');

  displayText.style.fontSize = size + 'px';
  if (key === flapBoardKey && displayText.childElementCount) return;

  flapBoardKey = key;
  buildFlapRows(rows);
}

/** Replace #display-text's contents with one .flap-row of .flap-tile per row. */
function buildFlapRows(rows) {
  displayText.innerHTML = '';
  rows.forEach((chars) => {
    const row = document.createElement('div');
    row.className = 'flap-row';

    chars.forEach((char) => {
      const tile = document.createElement('span');
      tile.className = 'flap-tile';
      tile.dataset.char = char;

      const face = document.createElement('span');
      face.className = 'flap-tile-face';
      face.textContent = char === ' ' ? '' : char;

      tile.appendChild(face);
      row.appendChild(tile);
    });

    displayText.appendChild(row);
  });
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
 * Read the live board back out of the DOM, one array of characters per
 * .flap-row. Used by generateShareImage() so the shared image matches the
 * on-screen rows exactly rather than recomputing the wrap independently.
 * @returns {string[][]} Rows of characters, in display order.
 */
function readFlapRows() {
  return Array.from(displayText.querySelectorAll('.flap-row')).map((row) =>
    Array.from(row.children).map((tile) => tile.dataset.char));
}

// ---------------------------------------------------------------------------
// Canvas image generation (T2.2)
// ---------------------------------------------------------------------------

/**
 * Render the current embiggened text to a canvas and return a PNG Blob.
 *
 * The output exactly matches what the user sees on screen:
 *   - Same font and per-line sizes as the on-screen layout (Default/Nothing:
 *     currentLayout from T5.1; airport: fitFlapBoard()'s size)
 *   - Same background and text colours (dark/light mode aware)
 *   - Same line breaks, horizontally and vertically centred
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

  // Create an off-screen canvas at physical pixel dimensions.
  const canvas = document.createElement('canvas');
  canvas.width  = vw * dpr;
  canvas.height = vh * dpr;

  const ctx = canvas.getContext('2d');

  // Scale the context so all subsequent drawing coordinates are in CSS pixels.
  ctx.scale(dpr, dpr);

  if (currentTheme === 'airport') {
    // Exact font-size that fitFlapBoard() set, e.g. "142px".
    drawFlapBoard(ctx, vw, vh, parseInt(displayText.style.fontSize, 10));
  } else {
    drawTextBlock(ctx, vw, vh);
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
 * Draw the Default/Nothing themes' per-line layout (currentLayout, T5.1) —
 * the same lines and font sizes the live display shows. Each line sits in a
 * line box of size × LINE_HEIGHT, with the text placed the way CSS places it
 * (font content area centred in the line box), so canvas matches the DOM.
 */
function drawTextBlock(ctx, vw, vh) {
  // Determine colours from the system colour-scheme preference.
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const bgColour   = isDark ? '#000000' : '#ffffff';
  const textColour = isDark ? '#ffffff' : '#000000';

  ctx.fillStyle = bgColour;
  ctx.fillRect(0, 0, vw, vh);

  if (!currentLayout) return;

  const family = displayFontFamily();
  const totalH = currentLayout.lines.reduce((sum, l) => sum + l.fontSize * LINE_HEIGHT, 0);
  let top = (vh - totalH) / 2;

  ctx.fillStyle = textColour;
  ctx.textAlign = 'center';

  currentLayout.lines.forEach((line) => {
    const lineH = line.fontSize * LINE_HEIGHT;
    ctx.font = `${line.fontSize}px ${family}`;

    const m = ctx.measureText(line.text);
    if (m.fontBoundingBoxAscent !== undefined) {
      const contentH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(line.text, vw / 2, top + (lineH - contentH) / 2 + m.fontBoundingBoxAscent);
    } else {
      ctx.textBaseline = 'middle';
      ctx.fillText(line.text, vw / 2, top + lineH / 2);
    }

    top += lineH;
  });
}

/**
 * Draw the airport theme's tile grid, reading actual row breaks back out of
 * the live DOM (readFlapRows()) so the image matches the on-screen
 * fixed-column wrap exactly rather than recomputing it independently.
 * Tile and glyph geometry (FLAP_* constants) mirrors the .flap-tile /
 * .flap-tile-face CSS rules in style.css.
 */
function drawFlapBoard(ctx, vw, vh, fontSizePx) {
  const BOARD_BG = '#0a0a0a';
  const TILE_BG  = '#161616';
  const TEXT_COLOUR = '#e8e4d8';
  const DIVIDER_COLOUR = 'rgba(0, 0, 0, 0.55)';

  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, vw, vh);

  const rows = readFlapRows();

  const margin   = fontSizePx * FLAP_TILE_MARGIN_EM;
  const tileW    = fontSizePx * FLAP_TILE_W_EM;
  const tileH    = fontSizePx * FLAP_TILE_H_EM;
  const totalH   = rows.length * tileH;
  const startY   = (vh - totalH) / 2;

  // The glyph is drawn the way CSS places it: the font's content area
  // (ascent + descent) centred on the tile, then nudged up. Baseline offset
  // from the tile centre = (ascent - descent) / 2, plus the nudge.
  const faceSize = fontSizePx * FLAP_FACE_SCALE;
  ctx.font = `600 ${faceSize}px ${AIRPORT_FONT}`;
  ctx.textAlign = 'center';
  const metrics = ctx.measureText('H');
  const hasFontMetrics = metrics.fontBoundingBoxAscent !== undefined;
  const baselineOffset = hasFontMetrics
    ? (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + FLAP_FACE_NUDGE_EM * faceSize
    : FLAP_FACE_NUDGE_EM * faceSize;
  ctx.textBaseline = hasFontMetrics ? 'alphabetic' : 'middle';

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
        ctx.fillText(char, cx, cy + baselineOffset);
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

  // Rows/lines are built by fitDisplay() once the view is visible and
  // measurable.
  displayText.innerHTML = '';
  flapBoardKey = '';
  console.log('Embiggen: text passed to display →', currentText);

  // Dismiss the on-screen keyboard before the display view appears so it
  // doesn't linger over the embiggened text on mobile (T3.3).
  inputText.blur();

  showView(viewDisplay);
  acquireWakeLock();

  // The layout must run before the animation so sizes are already correct at
  // the start of the scale — the animation only transforms the already-sized
  // element, it never changes font-size.
  fitDisplay();
  playEntranceAnimation();

  // Re-size once the display font is confirmed loaded (guards against
  // font-display:swap causing a mis-size on first visit before the woff2 has
  // been cached). If a resize is needed we replay the animation so the final
  // state matches.
  document.fonts.ready.then(() => {
    if (viewDisplay.classList.contains('active')) {
      fitDisplay();
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

  // Preload the display fonts so the first layout measures real font metrics
  // rather than fallback ones that would resize the text once the font
  // arrives (T4.4, T5.1). Failure is harmless — layout re-runs on
  // fonts.ready as before.
  [`600 1em ${AIRPORT_FONT}`, `1em ${NOTHING_FONT}`, "1em 'Anton'"].forEach((font) => {
    document.fonts.load(font).catch(() => {});
  });

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
      fitDisplay();
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
