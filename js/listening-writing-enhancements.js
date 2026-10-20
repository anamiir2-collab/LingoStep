/* LingoStep — character-by-character dictation feedback.
 * Keeps only the correct prefix, so learners must correct each letter
 * before progressing. Uses native Web Audio only after user interaction.
 */
export function attachCharacterCheck(input, target, opts = {}) {
  if (!input || typeof target !== 'string') return { destroy() {} };
  const expected = target;
  let wrongTimer = 0;

  function tone(correct) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = correct ? 740 : 190;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (correct ? 0.09 : 0.14));
      osc.start();
      osc.stop(ctx.currentTime + (correct ? 0.1 : 0.15));
      osc.onended = () => ctx.close();
    } catch { /* sound is optional; never block typing */ }
  }

  function onInput() {
    const value = input.value;
    let good = 0;
    while (good < value.length && good < expected.length &&
      value[good].toLocaleLowerCase() === expected[good].toLocaleLowerCase()) {
      good += 1;
    }
    if (good < value.length) {
      input.value = value.slice(0, good);
      try { input.setSelectionRange(good, good); } catch {}
      input.classList.remove('lw-character-wrong');
      // Restart the animation even when two errors happen quickly.
      void input.offsetWidth;
      input.classList.add('lw-character-wrong');
      window.clearTimeout(wrongTimer);
      wrongTimer = window.setTimeout(() => input.classList.remove('lw-character-wrong'), 420);
      tone(false);
      if (typeof opts.onWrong === 'function') opts.onWrong(good, value[good]);
      return;
    }
    if (value.length > 0) {
      input.classList.add('lw-character-correct');
      tone(true);
      if (typeof opts.onCorrect === 'function') opts.onCorrect(value.length);
    } else {
      input.classList.remove('lw-character-correct');
    }
  }

  input.addEventListener('input', onInput);
  return {
    destroy() {
      input.removeEventListener('input', onInput);
      window.clearTimeout(wrongTimer);
    },
  };
}
