/* ============================================================
   LingoStep — letter-track.js
   YouType-style dictation surface: every letter sits above its
   own underline, words stay intact when they wrap to a new line,
   and spaces own a visible gap slot between words.

   Design goals (spec: interactive writing UI):
   - One REAL <input> stays the single source of truth, so native
     phone keyboards (Android/iOS), Backspace, space and paste all
     work naturally. The slots are a pure mirror of input.value.
   - The current position is highlighted with the app's purple
     accent; filled slots turn green; the surface shakes on a
     rejected letter (class added by the lesson engine).
   - Words are rendered as unbreakable groups, so long sentences
     wrap cleanly word-by-word instead of splitting mid-word.
   - Pure helpers (splitSegments / letterStates) are DOM-free so
     they are Node-testable (tests/letter-track-tests.js).
   ============================================================ */

/**
 * Split an expected sentence into word/gap segments.
 * "Hi there." →
 *   [{ type:'word', start:0, end:2 }, { type:'gap', start:2, end:3 },
 *    { type:'word', start:3, end:9 }]
 * end is exclusive; gaps cover runs of space characters.
 */
export function splitSegments(expected) {
  const text = String(expected ?? '');
  const segments = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') {
      let j = i;
      while (j < text.length && text[j] === ' ') j += 1;
      segments.push({ type: 'gap', start: i, end: j });
      i = j;
    } else {
      let j = i;
      while (j < text.length && text[j] !== ' ') j += 1;
      segments.push({ type: 'word', start: i, end: j });
      i = j;
    }
  }
  return segments;
}

/**
 * Per-character state of the expected sentence for a typed value.
 * Returns an array aligned with Array.from(expected):
 *   'filled'  — a (case-insensitively) matching char was typed here
 *   'wrong'   — a char occupies this slot but does not match
 *               (transient: the rejection logic trims these away)
 *   'current' — the next position the user must type
 *   'empty'   — not reached yet
 * Punctuation marks are optional: a mark the learner skipped is
 * shown as 'filled' (auto-completed) and never blocks completion.
 */
export function letterStates(expected, typed) {
  const exp = Array.from(String(expected ?? ''));
  const val = Array.from(String(typed ?? ''));
  const a = alignTyped(expected, typed);
  const wrongRun = a.complete ? 0 : Math.max(0, val.length - a.typedUsed);
  return exp.map((ch, i) => {
    if (i < a.matched) return 'filled';
    if (i < a.matched + wrongRun) return 'wrong';
    if (i === a.matched && !a.complete) return 'current';
    return 'empty';
  });
}

/* ---------- punctuation-optional alignment ---------- */

/**
 * True when the learner never has to type this character.
 * - punctuation (. , ? ! : ; quotes, brackets, Arabic marks) → optional
 * - apostrophes INSIDE words (don't, I'm, it's) stay required
 * - hyphens stay required (they belong to compound words)
 */
export function isOptionalChar(ch, prev, next) {
  if (!ch) return false;
  if (ch === "'" || ch === '\u2018' || ch === '\u2019') {
    // Word-internal apostrophes (don't, I'm, it's) are part of the word
    // and stay required (requirement 8). Quote-like ones stay optional.
    const wordChar = (c) => /[a-z0-9]/i.test(String(c ?? ''));
    if (wordChar(prev) && wordChar(next)) return false;
    return true;
  }
  // Punctuation stays printed in place; learners type letters and spaces only.
  return '.,!?;:"()[]{}'.includes(ch)
    || ['\u201C', '\u201D', '\u2026', '\u060C', '\u061B', '\u061F', '\u00A1', '\u00BF'].includes(ch);
}/**
 * Align a typed value against the expected sentence with optional
 * punctuation. Pure and DOM-free (Node-testable).
 * Returns:
 *   matched    — number of EXPECTED chars consumed (slots to show filled)
 *   typedUsed  — number of typed chars accepted
 *   complete   — every required char of `expected` was matched
 *   extraBad   — typed value continues past completion with real letters
 */
export function alignTyped(expected, typed) {
  const exp = Array.from(String(expected ?? ''));
  const val = Array.from(String(typed ?? ''));
  let e = 0, v = 0;
  while (e < exp.length) {
    const ch = exp[e];
    if (v < val.length && val[v].toLocaleLowerCase() === ch.toLocaleLowerCase()) {
      v += 1; e += 1; continue;
    }
    if (isOptionalChar(ch, exp[e - 1], exp[e + 1])) { e += 1; continue; } // skip skipped punctuation
    break; // real mismatch on a required char
  }
  let complete = true;
  for (let k = e; k < exp.length; k++) {
    if (!isOptionalChar(exp[k], exp[k - 1], exp[k + 1])) { complete = false; break; }
  }
  let extraBad = false;
  if (complete && v < val.length) {
    for (let k = v; k < val.length; k++) {
      if (!isOptionalChar(val[k], val[k - 1], val[k + 1])) { extraBad = true; break; }
    }
  }
  return { matched: e, typedUsed: v, complete: complete && !extraBad, extraBad };
}

/**
 * Build the interactive typing surface for one sentence.
 * Returns { surface, track, input, render, destroy }:
 *   render(typedValue) — mirrors the value into the slots.
 *   destroy()          — removes the surface-level click listener.
 * The input element is real and focusable; the caller wires the
 * input/keydown/composition events (lesson-engine does).
 */
export function buildLetterSurface(expected, opts = {}) {
  const target = String(expected ?? '');
  const ariaLabel = opts.ariaLabel || 'Type what you hear';

  const surface = document.createElement('div');
  surface.className = 'lw-typing-surface';
  surface.setAttribute('dir', 'ltr');

  const track = document.createElement('div');
  track.className = 'lw-letter-track';
  track.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.className = 'lw-typing-input';
  input.type = 'text';
  input.dir = 'ltr';
  input.setAttribute('data-latin', 'true');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off'); // Safari: stop QuickType edits
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('aria-label', ariaLabel);

  const segments = splitSegments(target);
  const targetChars = Array.from(target);

  function render(typedValue) {
    const val = String(typedValue ?? '');
    const a = alignTyped(target, val);
    const states = letterStates(target, val);
    const typedChars = Array.from(val);
    track.replaceChildren();

    for (const seg of segments) {
      if (seg.type === 'gap') {
        // one visible gap slot per space character
        for (let i = seg.start; i < seg.end; i += 1) {
          const gap = document.createElement('span');
          gap.className = `lw-word-gap is-${states[i]}`;
          track.append(gap);
        }
        continue;
      }
      // a word never breaks across lines
      const word = document.createElement('span');
      word.className = 'lw-word';
      for (let i = seg.start; i < seg.end; i += 1) {
        const slot = document.createElement('span');
        slot.className = `lw-letter-slot is-${states[i]}`;
        const expectedChar = targetChars[i] ?? '';
        const isPunctuation = isOptionalChar(expectedChar, targetChars[i - 1], targetChars[i + 1]);
        if (isPunctuation) {
          // Punctuation is printed in its original position and never consumes a typed character.
          slot.textContent = expectedChar;
          slot.classList.add('is-punctuation');
        } else if (states[i] === 'filled' || states[i] === 'wrong') {
          // Map typed letters by the expected prefix, not by raw slot index;
          // skipped punctuation must not shift the letters that follow it.
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

    surface.classList.toggle('is-complete', a.complete);
  }

  const onClick = () => {
    // the invisible input covers the whole surface, so taps usually
    // reach it natively; this is a fallback for edge areas
    input.focus();
  };
  surface.addEventListener('click', onClick);

  surface.append(track, input);

  return {
    surface,
    track,
    input,
    render,
    destroy() {
      surface.removeEventListener('click', onClick);
    },
  };
}
