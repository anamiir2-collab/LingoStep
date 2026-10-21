/* ============================================================
   LingoStep — listening-writing-enhancements.js
   Character-by-character dictation feedback for Listening & Writing.

   Behaviour (spec: instant per-letter validation):
   - Keeps only the correct prefix: a wrong letter is rejected
     immediately, correct letters already typed are never lost,
     and the learner stays at the position they must complete.
   - Emits short Web-Audio tones: soft tick for a correct letter,
     low buzz for a rejected one, and a small ascending arpeggio
     when the whole sentence is completed.
   - Sound effects respect the user's `soundEffects` setting and
     are muted when it is off. Tones start only after real user
     interaction (browser autoplay policies).
   - One shared AudioContext is reused for every tone (creating a
     context per keystroke hits the browser's context limit and
     silently kills sound in long sessions).
   - Never throws: sound and animation are optional, typing must
     keep working even when Web Audio is unavailable.
   ============================================================ */

import { getSettings } from './settings.js';

/* ---------- shared audio ---------- */

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
  } catch { /* sound is optional; never block typing */ }
}

function effectsEnabled() {
  try {
    return getSettings().soundEffects !== false;
  } catch {
    return true;
  }
}

function soundCorrect() {
  if (!effectsEnabled()) return;
  tone(660, { dur: 0.07, gain: 0.045 });
}

function soundWrong() {
  if (!effectsEnabled()) return;
  tone(180, { dur: 0.13, gain: 0.05, type: 'sawtooth' });
}

function soundComplete() {
  if (!effectsEnabled()) return;
  tone(523.25, { dur: 0.09, gain: 0.055, delay: 0 });
  tone(659.25, { dur: 0.09, gain: 0.055, delay: 0.09 });
  tone(783.99, { dur: 0.16, gain: 0.06, delay: 0.18 });
}

/* ---------- character check ---------- */

/**
 * Attach strict prefix validation to a text input.
 * opts: { onCorrect(len), onWrong(goodIndex, wrongChar), onComplete() }
 * Returns { destroy }.
 */
export function attachCharacterCheck(input, target, opts = {}) {
  if (!input || typeof target !== 'string') return { destroy() {} };
  const expected = target;
  let wrongTimer = 0;
  let completed = false;

  function onInput() {
    const value = input.value;
    let good = 0;
    while (good < value.length && good < expected.length &&
      value[good].toLocaleLowerCase() === expected[good].toLocaleLowerCase()) {
      good += 1;
    }
    if (good < value.length) {
      // reject everything after the correct prefix, keep the prefix
      input.value = value.slice(0, good);
      try { input.setSelectionRange(good, good); } catch { /* no caret on some types */ }
      input.classList.remove('lw-character-wrong');
      // Restart the animation even when two errors happen quickly.
      void input.offsetWidth;
      input.classList.add('lw-character-wrong');
      window.clearTimeout(wrongTimer);
      wrongTimer = window.setTimeout(() => input.classList.remove('lw-character-wrong'), 420);
      soundWrong();
      if (typeof opts.onWrong === 'function') opts.onWrong(good, value[good]);
      return;
    }
    if (value.length > 0) {
      input.classList.add('lw-character-correct');
      soundCorrect();
      if (typeof opts.onCorrect === 'function') opts.onCorrect(value.length);
      if (!completed && value.length >= expected.length) {
        completed = true;
        soundComplete();
        if (typeof opts.onComplete === 'function') opts.onComplete();
      }
    } else {
      input.classList.remove('lw-character-correct');
    }
  }

  function onCompositionEnd() { onInput(); }

  input.addEventListener('input', onInput);
  input.addEventListener('compositionend', onCompositionEnd);
  return {
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('compositionend', onCompositionEnd);
      window.clearTimeout(wrongTimer);
    },
  };
}
