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
 */
export function letterStates(expected, typed) {
  const exp = Array.from(String(expected ?? ''));
  const val = Array.from(String(typed ?? ''));
  let good = 0;
  while (good < val.length && good < exp.length
    && val[good].toLocaleLowerCase() === exp[good].toLocaleLowerCase()) {
    good += 1;
  }
  return exp.map((ch, i) => {
    if (i < good) return 'filled';
    if (i < val.length) return 'wrong';
    if (i === good) return 'current';
    return 'empty';
  });
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
        if (states[i] === 'filled' || states[i] === 'wrong') {
          // show what the learner actually typed (rejections are trimmed
          // away by the character check, so 'wrong' is transient only)
          slot.textContent = typedChars[i] ?? targetChars[i] ?? '';
        }
        word.append(slot);
      }
      track.append(word);
    }

    surface.classList.toggle('is-complete', val.length >= target.length);
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
