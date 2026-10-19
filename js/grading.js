/* ============================================================
   LingoStep — grading.js
   Predictable, testable answer checking.

   Statuses returned by checkAnswer():
     'empty'     — nothing typed
     'correct'   — matches an accepted answer after core normalization
                   (case-insensitive, collapsed spaces, curly quotes)
     'minor'     — matches only after lenient passes
                   (trailing punctuation, or contraction expansion
                    when strict grading is off)
     'incorrect' — anything else (real grammar/spelling/punctuation
                   differences are respected, never auto-forgiven)

   Contractions: "don't" and "do not" are considered DIFFERENT by
   default (strict). With strict grading off they compare as 'minor'.
   ============================================================ */

/* ---------- normalization ---------- */

const CURLY_MAP = { '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201C': '"', '\u201D': '"', '\u2032': "'", '\u02BC': "'", '\u2013': '-', '\u2014': '-', '\u2026': '...' };

/** Core normalization: trim, collapse spaces, straighten quotes, lowercase. */
export function normalizeCore(s) {
  let out = String(s ?? '');
  out = out.replace(/[\u2018\u2019\u201A\u201C\u201D\u2032\u02BC\u2013\u2014\u2026]/g, (c) => CURLY_MAP[c] ?? c);
  out = out.trim().replace(/\s+/g, ' ').toLowerCase();
  return out;
}

/** Lenient pass 1: also drop trailing punctuation. */
export function normalizeLenient(s) {
  return normalizeCore(s).replace(/[.!?;,:\u2026]+$/, '').replace(/\s+/g, ' ').trim();
}

/** Lenient pass 2 (only when strict grading is off): expand contractions. */
const CONTRACTIONS = [
  [/\bdon[' ]?t\b/g, 'do not'], [/\bdoesn[' ]?t\b/g, 'does not'], [/\bdidn[' ]?t\b/g, 'did not'],
  [/\bisn[' ]?t\b/g, 'is not'], [/\baren[' ]?t\b/g, 'are not'], [/\bwasn[' ]?t\b/g, 'was not'],
  [/\bweren[' ]?t\b/g, 'were not'], [/\bhasn[' ]?t\b/g, 'has not'], [/\bhaven[' ]?t\b/g, 'have not'],
  [/\bhadn[' ]?t\b/g, 'had not'], [/\bcan[' ]?t\b/g, 'cannot'], [/\bcouldn[' ]?t\b/g, 'could not'],
  [/\bshouldn[' ]?t\b/g, 'should not'], [/\bwouldn[' ]?t\b/g, 'would not'], [/\bwilln[' ]?t\b/g, 'will not'],
  [/\bwon[' ]?t\b/g, 'will not'], [/\bmustn[' ]?t\b/g, 'must not'], [/\bain[' ]?t\b/g, 'is not'],
  [/\blet[' ]?s\b/g, 'let us'], [/\bi[' ]?m\b/g, 'i am'], [/\bit[' ]?s\b/g, 'it is'],
  [/\bthat[' ]?s\b/g, 'that is'], [/\bthere[' ]?s\b/g, 'there is'], [/\bwhat[' ]?s\b/g, 'what is'],
  [/\bwho[' ]?s\b/g, 'who is'], [/\bshe[' ]?s\b/g, 'she is'], [/\bhe[' ]?s\b/g, 'he is'],
  [/\bwe[' ]?re\b/g, 'we are'], [/\bthey[' ]?re\b/g, 'they are'], [/\byou[' ]?re\b/g, 'you are'],
  [/\bi[' ]?ve\b/g, 'i have'], [/\bwe[' ]?ve\b/g, 'we have'], [/\bthey[' ]?ve\b/g, 'they have'],
  [/\byou[' ]?ve\b/g, 'you have'], [/\bi[' ]?ll\b/g, 'i will'], [/\bwe[' ]?ll\b/g, 'we will'],
  [/\bthey[' ]?ll\b/g, 'they will'], [/\byou[' ]?ll\b/g, 'you will'], [/\bshe[' ]?ll\b/g, 'she will'],
  [/\bhe[' ]?ll\b/g, 'he will'], [/\bit[' ]?ll\b/g, 'it will'], [/\bi[' ]?d\b/g, 'i would'],
  [/\bwe[' ]?d\b/g, 'we would'], [/\bthey[' ]?d\b/g, 'they would'], [/\byou[' ]?d\b/g, 'you would'],
  [/\bshe[' ]?d\b/g, 'she would'], [/\bhe[' ]?d\b/g, 'he would'],
];

export function expandContractions(s) {
  let out = String(s ?? '').toLowerCase();
  for (const [re, rep] of CONTRACTIONS) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
}

/* ---------- word diff for feedback ---------- */

/** Returns 1-based index of first differing word, or 0 if identical. */
export function firstDiffWord(userCore, expectedCore) {
  const a = userCore.split(' ');
  const b = expectedCore.split(' ');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { word: i + 1, typed: a[i] || '—', expected: b[i] || '—' };
  }
  return { word: 0, typed: '', expected: '' };
}

/* ---------- main API ---------- */

/**
 * checkAnswer(userInput, acceptedAnswers, options)
 * options: { strict: true } — strict=true keeps contractions distinct.
 * acceptedAnswers: array of strings (must be non-empty).
 * Returns { status, matchedAnswer, diff } where diff = {word, typed, expected}.
 */
export function checkAnswer(userInput, acceptedAnswers, options = {}) {
  const strict = options.strict !== false;
  const accepted = (Array.isArray(acceptedAnswers) ? acceptedAnswers : [acceptedAnswers])
    .filter((a) => typeof a === 'string' && a.trim().length > 0);

  if (typeof userInput !== 'string' || userInput.trim().length === 0) {
    return { status: 'empty', matchedAnswer: null, diff: { word: 0, typed: '', expected: '' } };
  }
  if (accepted.length === 0) {
    // Degenerate exercise data: treat whitespace-only equivalence as correct.
    return normalizeCore(userInput).length > 0
      ? { status: 'incorrect', matchedAnswer: null, diff: { word: 0, typed: '', expected: '' } }
      : { status: 'empty', matchedAnswer: null, diff: { word: 0, typed: '', expected: '' } };
  }

  const userCore = normalizeCore(userInput);
  let best = null;

  for (const ans of accepted) {
    const expCore = normalizeCore(ans);

    if (userCore === expCore) {
      const r = { status: 'correct', matchedAnswer: ans, diff: { word: 0, typed: '', expected: '' } };
      return r; // cannot do better
    }

    let status = null;
    let usedAnswer = ans;

    // lenient pass 1: trailing punctuation
    if (normalizeLenient(userInput) === normalizeLenient(ans)) {
      status = 'minor';
    }

    // lenient pass 2: contraction expansion (only when strict is off)
    if (!strict && status === null) {
      if (expandContractions(normalizeLenient(userInput)) === expandContractions(normalizeLenient(ans))) {
        status = 'minor';
      }
    }

    const cand = {
      status: status ?? 'incorrect',
      matchedAnswer: usedAnswer,
      diff: firstDiffWord(userCore, expCore),
    };
    if (!best || rank(cand.status) > rank(best.status)) best = cand;
  }

  return best;
}

function rank(status) {
  return { correct: 3, minor: 2, incorrect: 1, empty: 0 }[status] ?? 0;
}

/** Boolean convenience: is the answer acceptable (correct or minor)? */
export function isAcceptable(userInput, acceptedAnswers, options = {}) {
  const r = checkAnswer(userInput, acceptedAnswers, options);
  return r.status === 'correct' || r.status === 'minor';
}

/* ---------- sentence helpers used by other modules ---------- */

/** Tokenize into words (letters/digits/apostrophes/hyphens kept). */
export function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Jaccard similarity of word sets (used by duplicate detector). */
export function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
