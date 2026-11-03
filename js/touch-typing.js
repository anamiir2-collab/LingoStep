/* ============================================================
   LingoStep — touch-typing.js  (v8 mobile transformation)
   100% keyboard-free answer surfaces for lessons, placement
   test and dialogue practice. NO real <input> element is ever
   created, so the Android/iOS system keyboard can NEVER appear
   during a learning activity.

   Two building blocks:

   1) createTouchTypingField({ expected, ... })
      Dictation surface for listen-and-type / dialogue practice.
      - The same YouType-style letter slots as before (letter-track
        helpers are reused, so slot states & punctuation rules are
        identical to the original app).
      - A built-in touch keyboard (QWERTY + ' + - + space + ⌫)
        drives a plain JS string buffer. Nothing to focus.
      - Validation parity with the original typing pipeline:
        a key that does not extend the correct prefix is rejected
        (shake + buzz), exactly like attachCharacterCheck did.
        Punctuation is optional (never typed); apostrophes inside
        words and hyphens stay required → the keyboard offers them.
      - Physical keyboards still work on desktop through a
        document-level keydown listener (no input to focus).

   2) createLetterTiles({ source, ... })
      Word/letter tile builder for fill-blank answers (original
      question + acceptedAnswers validation untouched): tiles of
      the blank word (or words for multi-word blanks), shuffled;
      tap to place, tap again to remove, ⌫ removes the last one.

   Pure logic helpers (validateKeystroke / buildTiles) are DOM-free
   and Node-testable.
   ============================================================ */

import { splitSegments, alignTyped, letterStates, isOptionalChar } from './letter-track.js';
import { getSettings } from './settings.js';
import { el } from './utils.js';

/* ---------- shared feedback tones (same policy as before) ---------- */

let sharedCtx = null;

function audioCtx() {
  try {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new Ctx();
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
}

function tone(freq, { dur = 0.09, delay = 0, gain = 0.06, type = 'sine' } = {}) {
  try {
    const ctx = audioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); } catch { /* ignore */ }
    };
  } catch { /* sound is optional; never block input */ }
}

function effectsEnabled() {
  try { return getSettings().soundEffects !== false; } catch { return true; }
}

function soundCorrect() { if (effectsEnabled()) tone(660, { dur: 0.07, gain: 0.045 }); }
function soundWrong() { if (effectsEnabled()) tone(180, { dur: 0.13, gain: 0.05, type: 'sawtooth' }); }
function soundComplete() {
  if (!effectsEnabled()) return;
  tone(523.25, { dur: 0.09, gain: 0.055, delay: 0 });
  tone(659.25, { dur: 0.09, gain: 0.055, delay: 0.09 });
  tone(783.99, { dur: 0.16, gain: 0.06, delay: 0.18 });
}
function soundErase() { if (effectsEnabled()) tone(440, { dur: 0.05, gain: 0.03 }); }

/* ============================================================
   Pure logic — Node-testable
   ============================================================ */

/**
 * Validate one keystroke against the expected sentence.
 * Mirrors the ORIGINAL character-check policy exactly:
 *   - unmatched letters before completion  → rejected
 *   - real letters typed beyond completion → rejected (original `extraBad`)
 *   - punctuation at/after completion      → accepted & kept (grading
 *     ignores punctuation, same as the original input pipeline)
 */
export function validateKeystroke(expected, buffer, ch) {
  const candidate = String(buffer ?? '') + String(ch ?? '');
  const a = alignTyped(expected, candidate);
  const before = alignTyped(expected, String(buffer ?? ''));
  const rejected = (a.typedUsed < candidate.length && !a.complete) || a.extraBad;
  if (rejected) return { accepted: false, buffer, complete: before.complete };
  return { accepted: true, buffer: candidate, complete: a.complete, progress: a.typedUsed - before.typedUsed };
}

/**
 * Backspace over the buffer. Returns the next buffer value.
 * Trailing optional punctuation is never in the buffer (never
 * typed), so a plain slice matches the original behavior.
 */
export function backspaceBuffer(buffer) {
  return String(buffer ?? '').slice(0, -1);
}

/**
 * Build the tile list for a fill-blank answer.
 * Single-word blanks → letters; multi-word blanks → words.
 * Shuffle is deterministic-safe: short answers never render in
 * the exact expected order (that would give the answer away).
 * Returns array of string tiles.
 */
export function buildTiles(source, random = Math.random) {
  const src = String(source ?? '').trim();
  if (!src) return [];
  const multiWord = /\s/.test(src);
  const tiles = multiWord ? src.split(/\s+/) : Array.from(src);
  // Fisher–Yates on a copy
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // never present the identity order for short tile sets
  const same = arr.length === tiles.length && arr.every((t, i) => t === tiles[i]);
  if (same && arr.length > 1) {
    [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
  }
  return arr;
}

/** The characters the touch keyboard must offer for a sentence. */
export function requiredKeyChars(expected) {
  const need = new Set();
  const chars = Array.from(String(expected ?? ''));
  // evaluate with REAL neighbors so word-internal apostrophes
  // (don't, I'm) are correctly detected as required
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/[a-z0-9]/i.test(ch)) continue;      // letters/digits: always offered
    if (isOptionalChar(ch, chars[i - 1], chars[i + 1])) continue; // optional punctuation: never typed
    if (ch === "'") need.add("'");
    if (ch === '-') need.add('-');
    if (ch === ' ') need.add('space');
  }
  return need;
}

/* ============================================================
   1) Touch typing field (dictation)
   ============================================================ */

const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/**
 * Create a keyboard-free dictation field.
 * opts: {
 *   expected:    String  — the full expected sentence (unchanged content)
 *   ariaLabel:   String
 *   onChanged:   (value) => void
 *   onWrong:     () => void    (rejected key)
 *   onComplete:  () => void    (sentence fully entered; fires once)
 *   labels:      { backspace, space }
 * }
 * Returns { root, surface, getValue, isComplete, shake, render, destroy }.
 */
export function createTouchTypingField(opts = {}) {
  const expected = String(opts.expected ?? '');
  const labels = opts.labels || {};
  const targetChars = Array.from(expected);
  const segments = splitSegments(expected);

  let buffer = '';
  let completed = false;
  let destroyed = false;

  /* ----- letter slots surface (no input element) ----- */
  const surface = el('div', { class: 'lw-typing-surface is-touch', dir: 'ltr' });
  const track = el('div', { class: 'lw-letter-track', 'aria-hidden': 'true' });
  surface.append(track);

  function renderSlots() {
    const states = letterStates(expected, buffer);
    const typedChars = Array.from(buffer);
    track.replaceChildren();
    for (const seg of segments) {
      if (seg.type === 'gap') {
        for (let i = seg.start; i < seg.end; i += 1) {
          track.append(el('span', { class: `lw-word-gap is-${states[i]}` }));
        }
        continue;
      }
      const word = el('span', { class: 'lw-word' });
      for (let i = seg.start; i < seg.end; i += 1) {
        const slot = el('span', { class: `lw-letter-slot is-${states[i]}` });
        const expectedChar = targetChars[i] ?? '';
        if (isOptionalChar(expectedChar, targetChars[i - 1], targetChars[i + 1])) {
          slot.textContent = expectedChar; // printed in place, never typed
          slot.classList.add('is-punctuation');
        } else if (states[i] === 'filled' || states[i] === 'wrong') {
          let typedIndex = 0;
          for (let j = 0; j < i; j += 1) {
            if (!isOptionalChar(targetChars[j], targetChars[j - 1], targetChars[j + 1])) typedIndex += 1;
          }
          slot.textContent = typedChars[typedIndex] ?? '';
        }
        word.append(slot);
      }
      track.append(word);
    }
    surface.classList.toggle('is-complete', completed);
  }

  /* ----- state changes ----- */
  function setBuffer(next, { silentComplete = false } = {}) {
    buffer = next;
    const a = alignTyped(expected, buffer);
    renderSlots();
    if (typeof opts.onChanged === 'function') opts.onChanged(buffer);
    if (!completed && a.complete) {
      completed = true;
      renderSlots();
      if (!silentComplete) soundComplete();
      if (typeof opts.onComplete === 'function') opts.onComplete();
    } else if (a.complete) {
      completed = true;
    }
  }

  function pressChar(ch) {
    if (destroyed || completed) return;
    const res = validateKeystroke(expected, buffer, ch);
    if (res.accepted) {
      soundCorrect();
      setBuffer(res.buffer);
    } else {
      soundWrong();
      shake();
      if (typeof opts.onWrong === 'function') opts.onWrong();
    }
  }

  function pressBackspace() {
    if (destroyed) return;
    if (completed) { // allow editing again after completion (restart case)
      completed = false;
      surface.classList.remove('is-complete');
    }
    if (!buffer) return;
    soundErase();
    setBuffer(backspaceBuffer(buffer), { silentComplete: true });
  }

  function shake() {
    surface.classList.remove('lw-shake');
    void surface.offsetWidth; // restart animation
    surface.classList.add('lw-shake');
    window.setTimeout(() => surface.classList.remove('lw-shake'), 420);
  }

  /* ----- touch keyboard ----- */
  const kb = el('div', { class: 'tt-keyboard', role: 'group', dir: 'ltr', 'aria-label': labels.aria || 'Answer keyboard' });
  const need = requiredKeyChars(expected);

  function key(text, { action = null, className = '', label = null, wide = false } = {}) {
    const b = el('button', {
      class: `tt-key ${className}${wide ? ' tt-key-wide' : ''}`,
      type: 'button',
      'aria-label': label || text,
      text,
    });
    // never steal focus → never triggers the system keyboard
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (action === 'backspace') return pressBackspace();
      if (action === 'space') return pressChar(' ');
      pressChar(text);
    });
    return b;
  }

  for (const row of KEY_ROWS) {
    const rowEl = el('div', { class: 'tt-row' });
    for (const ch of row) rowEl.append(key(ch));
    kb.append(rowEl);
  }
  const bottom = el('div', { class: 'tt-row tt-bottom' });
  if (need.has('-')) bottom.append(key('-', { className: 'tt-key-accent' }));
  if (need.has("'")) bottom.append(key("'", { className: 'tt-key-accent' }));
  bottom.append(key(labels.space || 'space', { action: 'space', className: 'tt-key-space', label: labels.space || 'Space' }));
  bottom.append(key('⌫', { action: 'backspace', className: 'tt-key-back', label: labels.backspace || 'Backspace' }));
  kb.append(bottom);

  const root = el('div', { class: 'tt-field' }, [surface, kb]);

  /* ----- desktop physical keyboard (optional, never on mobile) ----- */
  function onPhysicalKey(e) {
    if (destroyed) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      // desktop convenience: check / continue (same as the old input keydown)
      if (typeof opts.onEnter === 'function') { e.preventDefault(); opts.onEnter(); }
      return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); pressBackspace(); return; }
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pressChar(' '); return; }
    if (/^[a-zA-Z]$/.test(e.key)) { pressChar(e.key.toLowerCase()); return; }
    if (e.key === "'" || e.key === '-' || e.key === '\u2019') { pressChar(e.key === '\u2019' ? "'" : e.key); }
  }
  document.addEventListener('keydown', onPhysicalKey);

  renderSlots();

  return {
    root,
    surface,
    getValue: () => buffer,
    setValue: (v) => { completed = false; setBuffer(String(v ?? ''), { silentComplete: true }); },
    isComplete: () => completed,
    shake,
    render: renderSlots,
    destroy() {
      destroyed = true;
      document.removeEventListener('keydown', onPhysicalKey);
    },
  };
}

/* ============================================================
   2) Letter/word tiles (fill-blank)
   ============================================================ */

/**
 * Create a tile-based answer builder for fill-blank exercises.
 * opts: {
 *   source:      String — the blank word (or multi-word phrase)
 *   ariaLabel:   String
 *   labels:      { backspace, clear }
 *   onChanged:   (value) => void
 * }
 * Returns { root, getValue, reset, destroy }.
 * The value is built ONLY from taps; validation stays with the
 * original checkAnswer(acceptedAnswers) pipeline.
 */
export function createLetterTiles(opts = {}) {
  const labels = opts.labels || {};
  const tiles = buildTiles(opts.source);
  const placed = []; // { tile, btn, bankBtn }

  const root = el('div', { class: 'tiles-field', dir: 'ltr' });
  const answerRow = el('div', { class: 'tiles-answer', 'aria-label': opts.ariaLabel || 'Answer' });
  const bankRow = el('div', { class: 'tiles-bank', role: 'group', 'aria-label': opts.ariaLabel || 'Tiles' });
  const actionsRow = el('div', { class: 'tiles-actions' });
  root.append(answerRow, bankRow, actionsRow);

  const backBtn = el('button', {
    class: 'tt-key tt-key-back tiles-action-btn', type: 'button',
    'aria-label': labels.backspace || 'Backspace', text: '⌫',
  });
  backBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  backBtn.addEventListener('click', () => removeLast());
  const clearBtn = el('button', {
    class: 'tt-key tiles-action-btn', type: 'button',
    'aria-label': labels.clear || 'Clear', text: '✕',
  });
  clearBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  clearBtn.addEventListener('click', () => reset());
  actionsRow.append(backBtn, clearBtn);

  function emit() {
    if (typeof opts.onChanged === 'function') opts.onChanged(getValue());
  }

  function place(tileText, bankBtn) {
    if (placed.length >= tiles.length) return;
    const placedBtn = el('button', { class: 'tile tile-placed', type: 'button', text: tileText });
    placedBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    placedBtn.addEventListener('click', () => {
      const at = placed.findIndex((p) => p.btn === placedBtn);
      if (at < 0) return;
      const [removed] = placed.splice(at, 1);
      removed.bankBtn.classList.remove('tile-used');
      removed.bankBtn.disabled = false;
      placedBtn.remove();
      soundErase();
      emit();
    });
    placed.push({ tile: tileText, btn: placedBtn, bankBtn });
    answerRow.append(placedBtn);
    if (bankBtn) {
      bankBtn.classList.add('tile-used');
      bankBtn.disabled = true;
    }
    soundCorrect();
    emit();
  }

  function removeLast() {
    if (!placed.length) return;
    const removed = placed.pop();
    removed.btn.remove();
    if (removed.bankBtn) {
      removed.bankBtn.classList.remove('tile-used');
      removed.bankBtn.disabled = false;
    }
    soundErase();
    emit();
  }

  function reset() {
    while (placed.length) removeLast();
    emit();
  }

  for (const t of tiles) {
    const b = el('button', { class: 'tile', type: 'button', text: t });
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (!b.disabled) place(t, b); });
    bankRow.append(b);
  }

  function getValue() {
    return placed.map((p) => p.tile).join('');
  }

  return {
    root,
    getValue,
    reset,
    destroy() { root.remove(); },
  };
}
