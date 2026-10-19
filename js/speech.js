/* ============================================================
   LingoStep — speech.js
   Browser-native text-to-speech via Web Speech API (speechSynthesis).
   No paid API, no keys, no network requirement beyond what the
   browser/OS provides for its own voices.

   Honest limitations (also shown in UI):
   - Voice availability depends on browser + OS.
   - Offline quality depends on locally installed voices.
   ============================================================ */

let cachedVoices = [];
let voicesLoaded = false;

export function isSupported() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function synth() {
  return window.speechSynthesis;
}

/** Load voices; resolves quickly, retries (Chrome loads voices async). */
export function loadVoices() {
  return new Promise((resolve) => {
    if (!isSupported()) { resolve([]); return; }
    const read = () => {
      const v = synth().getVoices() || [];
      cachedVoices = v;
      if (v.length) voicesLoaded = true;
      return v;
    };
    const first = read();
    if (first.length) { resolve(first); return; }
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const v = read();
      if (v.length || tries > 20) {
        clearInterval(timer);
        resolve(v);
      }
    }, 250);
    if (typeof synth().addEventListener === 'function') {
      synth().addEventListener('voiceschanged', () => read(), { once: true });
    }
  });
}

/** All English voices (name contains en- or lang starts with en). */
export function englishVoices() {
  return cachedVoices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
}

/** Pick a good default English voice: en-US / en-GB natural-sounding first. */
export function pickDefaultVoice() {
  const voices = englishVoices();
  if (!voices.length) return null;
  const score = (v) => {
    const n = (v.name || '').toLowerCase();
    const lang = (v.lang || '').toLowerCase();
    let s = 0;
    if (lang.startsWith('en-us')) s += 3;
    if (lang.startsWith('en-gb')) s += 2;
    if (/google|natural|premium|enhanced|siri/.test(n)) s += 4;
    if (v.localService) s += 2;
    if (/female|zira|samantha|susan|aria|jenny/.test(n)) s += 1;
    if (v.default) s += 1;
    return s;
  };
  return voices.sort((a, b) => score(b) - score(a))[0];
}

/**
 * Speak an English sentence.
 * opts: { voiceURI, rate (0.5–1.3), onend, onerror }
 * Cancels any current speech first. Returns false if unsupported.
 */
export function speak(text, opts = {}) {
  if (!isSupported() || !text) return false;
  const s = synth();
  s.cancel(); // stop previous speech immediately
  const u = new window.SpeechSynthesisUtterance(String(text));
  u.lang = 'en-US';
  u.rate = clampRate(opts.rate ?? 1);
  u.pitch = 1;
  u.volume = 1;

  const voice = findVoice(opts.voiceURI);
  if (voice) { u.voice = voice; u.lang = voice.lang || 'en-US'; }

  if (typeof opts.onend === 'function') u.onend = () => opts.onend();
  if (typeof opts.onerror === 'function') u.onerror = (e) => opts.onerror(e);

  // Small timeout guards against Chrome's occasional silent failure.
  try { s.speak(u); } catch { return false; }
  return true;
}

export function stopSpeaking() {
  if (isSupported()) {
    try { synth().cancel(); } catch { /* ignore */ }
  }
}

export function clampRate(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.3, Math.max(0.5, n));
}

function findVoice(uri) {
  if (!uri) return pickDefaultVoice();
  return cachedVoices.find((v) => v.voiceURI === uri) || pickDefaultVoice();
}

/** Optional: speech recognition availability (never required by the app). */
export function recognitionSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}
