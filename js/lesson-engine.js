/* ============================================================
   LingoStep — lesson-engine.js
   Renders the lesson player: exercises (listen-and-type,
   fill-blank, word-order, multiple-choice), audio controls,
   feedback, progress, resume, completion summary.
   Also powers revision sessions (opts.reviewMode).
   ============================================================ */

import { el, toast } from './utils.js';
import { icon, iconLabel } from './icons.js';
import { t } from './i18n.js';
import { getSettings } from './settings.js';
import { checkAnswer, wordDiff } from './grading.js';
import { speak, stopSpeaking, isSupported as speechSupported } from './speech.js';
import { recordAttempt, updateLessonState, saveResume, getLessonState } from './progress.js';
import { upsertOnWrong, gradeReview } from './review.js';
import { navigate } from './router.js';
import { getManifestEntry, nextLessonInSection, loadLesson } from './lesson-loader.js';
import { attachKeyboard } from './keyboard.js';
import { awardExercise, awardLessonComplete, markFirstAttemptFailed, getTotalXp } from './xp.js';
import { messageForCorrect, messageForWrong, messageForXp, messageForLessonComplete } from './motivation.js';
import { analyzeSentence, renderWordCards } from './word-cards.js';
import { attachCharacterCheck } from './listening-writing-enhancements.js';

const rank = { correct: 3, minor: 2, incorrect: 1, skipped: 0 };

/**
 * Render a lesson player into `container`.
 * opts.reviewMode: { items: [{exerciseId, lessonId, tags}] } → revision session.
 */
export async function renderLessonPlayer(container, lessonId, opts = {}) {
  const settings = getSettings();
  const L = settings.lang;
  const reviewMode = Boolean(opts.reviewMode);

  stopSpeaking();

  // ---------- resolve exercises ----------
  let exercises = [];
  let lesson = null;
  try {
    if (reviewMode) {
      const byLesson = new Map();
      for (const item of opts.reviewMode.items) {
        if (!byLesson.has(item.lessonId)) byLesson.set(item.lessonId, await loadLesson(item.lessonId));
      }
      exercises = opts.reviewMode.items.map((item) => {
        const les = byLesson.get(item.lessonId);
        const ex = les.exercises.find((x) => x.id === item.exerciseId);
        return ex ? { ...ex, lessonId: item.lessonId } : null;
      }).filter(Boolean);
    } else {
      lesson = await loadLesson(lessonId);
      exercises = lesson.exercises.map((ex) => ({ ...ex, lessonId }));
    }
  } catch (err) {
    renderErrorState(container, L, err);
    return;
  }

  if (!exercises.length) {
    container.replaceChildren(el('div', { class: 'state-box' }, [
      el('div', { class: 'big' }, [icon('mail')]),
      el('h3', { text: reviewMode ? t(L, 'reviewEmpty') : t(L, 'lessonError') }),
    ]));
    return;
  }

  // ---------- state ----------
  let idx = 0;
  let checked = false;        // current exercise already checked?
  let lastResult = null;      // {status, ...}
  let exStart = Date.now();
  let sessionStart = Date.now();
  let results = new Array(exercises.length).fill(null);
  let retryMode = false;      // session re-runs previously wrong exercises
  const originalExercises = exercises; // for retry index mapping
  let originalCount = exercises.length;
  let sessionXp = 0;          // XP earned in this session (real deltas)
  let lastMotivation = '';    // avoid repeating the same message
  const firstAttemptMap = new Map(); // exerciseId -> false once answered wrong/skipped
  const hintUsedSet = new Set();     // exerciseIds where a hint was opened
  let keyboardHandle = null;         // { destroy } for the on-screen keyboard

  // resume (normal lessons only)
  if (!reviewMode) {
    const st = await getLessonState(lessonId);
    if (st && typeof st.lastIndex === 'number' && st.lastIndex > 0 && st.lastIndex < exercises.length) {
      const attempted = Object.keys(st.attempted || {}).length;
      if (attempted < exercises.length) {
        idx = st.lastIndex;
        toast(t(L, 'resume'), 1800);
      }
    }
  }

  const entry = getManifestEntry(lessonId);

  // ---------- shell ----------
  container.replaceChildren();

  const head = el('div', { class: 'player-head' });
  const body = el('div');
  container.append(head, body);

  function renderHead() {
    head.replaceChildren();
    const backTarget = reviewMode ? '#/review' : `#/section/${lesson.section}`;
    const kicker = reviewMode ? t(L, 'reviewMode') : sectionLabel(lesson.section, L);
    const title = reviewMode ? t(L, 'reviewTitle') : lesson.title;
    const doneSoFar = results.filter((r) => r && rank[r.status] >= rank.minor).length;
    const ringPct = Math.round((doneSoFar / exercises.length) * 100);

    head.append(
      el('div', { class: 'lesson-top' }, [
        el('a', {
          class: 'lesson-back',
          href: backTarget,
          'aria-label': t(L, reviewMode ? 'exitReview' : 'exitLesson'),
          onclick: (e) => { e.preventDefault(); confirmExit(); },
        }, [icon(reviewMode ? 'close' : 'arrowLeft')]),
        el('div', { class: 'lesson-top-titles' }, [
          el('div', { class: 'lesson-top-kicker', text: `${t(L, 'sectionLabel')} · ${kicker}` }),
          el('h2', { text: title }),
        ]),
        el('div', { class: 'ring-sm', style: { '--pct': String(ringPct) }, role: 'img', 'aria-label': `${ringPct}%`, text: `${ringPct}%` }),
      ]),
    );
  }

  function sectionLabel(sec, lang) {
    const names = {
      en: {
        basics: 'Basics & Sentence Structure', tenses: 'English 16 Tenses Mastery',
        grammar: 'Grammar, Questions & Negation', conversations: 'Daily English Conversations',
        'practical-scenarios': 'Travel, Work & Practical Situations', vocabulary: 'Vocabulary & Expressions',
        'listening-writing': 'Listening, Dictation & Writing',
      },
      ar: {
        basics: 'الأساسيات وبناء الجملة', tenses: 'إتقان الأزمنة الستة عشر',
        grammar: 'القواعد والأسئلة والنفي', conversations: 'المحادثات اليومية',
        'practical-scenarios': 'السفر والعمل والمواقف العملية', vocabulary: 'المفردات والتعبيرات',
        'listening-writing': 'الاستماع والإملاء والكتابة',
      },
    };
    return names[lang][sec] || sec;
  }

  async function confirmExit() {
    stopSpeaking();
    if (reviewMode) { navigate('review'); return; }
    if (typeof confirm !== 'undefined' && !confirm(t(L, 'confirmExit'))) return;
    navigate('section', [lesson.section]);
  }

  // ---------- main exercise render ----------
  function renderExercise() {
    checked = false;
    lastResult = null;
    exStart = Date.now();
    if (keyboardHandle) { try { keyboardHandle.destroy(); } catch { /* ignore */ } keyboardHandle = null; }
    renderHead();
    body.replaceChildren();

    const ex = exercises[idx];
    const doneCount = results.filter((r) => r && rank[r.status] >= rank.minor).length;

    // progress strip: counter + linear bar (position-based)
    const progressPct = Math.round(((idx) / exercises.length) * 100);
    body.append(
      el('div', { class: 'ex-progress' }, [
        el('span', { class: 'ex-counter', text: reviewMode ? t(L, 'exerciseCounter', { i: idx + 1, n: exercises.length }) : t(L, 'sentenceCounter', { i: idx + 1, n: exercises.length }) }),
        el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': progressPct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, [
          el('span', { style: { width: `${progressPct}%` } }),
        ]),
      ]),
    );

    // every sentence lives in its own self-contained card:
    // number chip, media/prompt, input, check action, hint and feedback
    const card = el('div', { class: 'sentence-card' });
    const cardHead = el('div', { class: 'sentence-head' }, [
      el('span', { class: 'sc-num', text: reviewMode ? t(L, 'exerciseCounter', { i: idx + 1, n: exercises.length }) : t(L, 'sentenceCounter', { i: idx + 1, n: exercises.length }) }),
      el('span', { class: 'chip sc-type', text: typeLabel(ex.type, L) }),
      ...(doneCount ? [el('span', { class: 'chip chip-done' }, [iconLabel('check', String(doneCount))])] : []),
    ]);
    card.append(cardHead);

    const inputRow = el('div', { class: 'answer-row' });
    const feedbackBox = el('div');
    const actions = el('div', { class: 'card-actions' });
    state.feedbackBox = feedbackBox;
    state.card = card;

    const checkBtn = el('button', {
      class: 'btn btn-primary',
      onclick: () => onCheck(),
    }, [iconLabel('check', t(L, 'checkAnswer'))]);
    const hintBtn = el('button', { class: 'btn btn-round', 'aria-label': t(L, 'hint'), title: t(L, 'hint'), onclick: () => showHint(ex) }, [icon('bulb')]);
    const skipBtn = el('button', { class: 'btn btn-ghost btn-sm', text: t(L, 'skip'), onclick: onSkip });
    state.checkBtn = checkBtn;
    state.hintBtn = hintBtn;
    state.skipBtn = skipBtn;

    if (ex.type === 'listen-and-type') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'typeWhatYouHear') }));
      const audioRow = el('div', { class: 'audio-row' });
      const listenBtn = el('button', { class: 'audio-main', 'aria-label': t(L, 'play'), title: t(L, 'play'), onclick: () => playAudio(ex.en) }, [icon('audio')]);
      const slowBtn = el('button', { class: 'audio-slow', 'aria-label': t(L, 'playSlow'), title: t(L, 'playSlow'), onclick: () => playAudio(ex.en, 0.65) }, [icon('turtle')]);
      audioRow.append(listenBtn, slowBtn);
      if (!speechSupported()) {
        audioRow.append(el('p', { class: 'muted small', text: t(L, 'speechUnavailable') }));
        // If speech is unavailable, show the sentence so the exercise stays usable.
        card.append(el('div', { class: 'sentence-text', dir: 'ltr', text: ex.en }));
      } else {
        audioRow.append(el('span', { class: 'audio-caption', text: `${t(L, 'play')} · ${t(L, 'playSlow')}` }));
        card.append(audioRow);
        setTimeout(() => playAudio(ex.en), 250); // auto-play once per exercise
      }
      if (settings.showArabic && ex.ar) {
        card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));
      }
      const input = el('input', { type: 'text', dir: 'ltr', 'data-latin': 'true', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t(L, 'typeWhatYouHear'), placeholder: '…' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checked ? onNext() : onCheck(); } });
      attachCharacterCheck(input, { onCorrect: () => {}, onWrong: () => {} });
      inputRow.append(input);
      const kbMount = el('div', { class: 'kb-mount' });
      card.append(inputRow, kbMount);
      keyboardHandle = attachKeyboard(input, kbMount, settings.onScreenKeyboard, {
        clear: t(L, 'resetWordOrder'), enter: t(L, 'checkAnswer'),
      });
      actions.append(checkBtn, hintBtn, skipBtn);
      card.append(actions);
      setTimeout(() => input.focus(), 120);
      state.input = input;
    }

    if (ex.type === 'fill-blank') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'fillPrompt') }));
      card.append(el('div', { class: 'blank-display', dir: 'ltr', html: trustedBlankHtml(ex.display) }));
      if (settings.showArabic && ex.ar) card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));
      const input = el('input', { type: 'text', dir: 'ltr', 'data-latin': 'true', autocomplete: 'off', spellcheck: 'false', 'aria-label': t(L, 'fillPrompt'), placeholder: '…' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checked ? onNext() : onCheck(); } });
      inputRow.append(input);
      const kbMount2 = el('div', { class: 'kb-mount' });
      card.append(inputRow, kbMount2);
      keyboardHandle = attachKeyboard(input, kbMount2, settings.onScreenKeyboard, {
        clear: t(L, 'resetWordOrder'), enter: t(L, 'checkAnswer'),
      });
      actions.append(checkBtn, hintBtn, skipBtn);
      card.append(actions);
      setTimeout(() => input.focus(), 120);
      state.input = input;
    }

    if (ex.type === 'word-order') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'wordOrderPrompt') }));
      const tray = el('div', { class: 'word-order-tray', 'aria-label': t(L, 'wordOrderPrompt') });
      const bank = el('div', { class: 'word-order-bank' });
      card.append(tray, bank);
      if (settings.showArabic && ex.ar) card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));

      const placed = [];
      const chips = ex.words.map((w, i) => {
        const chip = el('button', { class: 'wo-chip', text: w, 'data-i': String(i) });
        chip.addEventListener('click', () => {
          if (chip.classList.contains('used')) return;
          chip.classList.add('used');
          placed.push({ w, chip });
          const placedChip = el('button', { class: 'wo-chip placed', text: w });
          placedChip.addEventListener('click', () => {
            const at = placed.findIndex((p) => p.chip === chip);
            if (at >= 0) placed.splice(at, 1);
            chip.classList.remove('used');
            placedChip.remove();
          });
          tray.append(placedChip);
        });
        bank.append(chip);
        return chip;
      });
      const clearBtn = el('button', { class: 'btn btn-ghost btn-sm', text: t(L, 'resetWordOrder'), onclick: () => renderExercise() });
      state.resetBtn = clearBtn;
      card.append(inputRow);
      actions.append(clearBtn, checkBtn, hintBtn, skipBtn);
      card.append(actions);
      state.getWordOrder = () => placed.map((p) => p.w).join(' ');
      state.wordOrderComplete = () => placed.length === ex.words.length;
    }

    if (ex.type === 'multiple-choice') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'mcPrompt') }));
      card.append(el('div', { class: 'sentence-text', dir: 'ltr', text: ex.question }));
      if (settings.showArabic && ex.ar) card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));
      const optsBox = el('div', { class: 'mc-options', role: 'listbox' });
      let selected = -1;
      ex.options.forEach((optText, i) => {
        const b = el('button', { class: 'mc-option', text: optText, role: 'option' });
        b.addEventListener('click', () => {
          if (checked) return;
          selected = i;
          optsBox.querySelectorAll('.mc-option').forEach((n) => n.classList.remove('selected'));
          b.classList.add('selected');
        });
        optsBox.append(b);
      });
      card.append(optsBox);
      card.append(inputRow);
      actions.append(checkBtn, skipBtn);
      card.append(actions);
      state.getSelected = () => selected;
    }

    // feedback lives inside the same card, right after the actions
    card.append(feedbackBox);
    body.append(card);

    body.append(el('p', { class: 'muted small center', style: { marginTop: '.7rem' } }, [
      el('kbd', { text: '⏎' }), ` = ${t(L, 'checkAnswer')} / ${t(L, 'nextExercise')}`,
    ]));
    if (!reviewMode && entry && !retryMode) {
      // keep resume position fresh (retry subsets must not corrupt it)
      saveResume(lessonId, idx);
    }
  }

  const state = {};

  function trustedBlankHtml(display) {
    // display is trusted lesson content; still escape all but our ___ marker
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(display).replace(/___/g, '<span class="blank">…</span>');
  }

  function typeLabel(type, lang) {
    const names = {
      en: { 'listen-and-type': 'Listen & type', 'fill-blank': 'Fill the blank', 'word-order': 'Word order', 'multiple-choice': 'Choose' },
      ar: { 'listen-and-type': 'استمع واكتب', 'fill-blank': 'أكمل الفراغ', 'word-order': 'رتّب الكلمات', 'multiple-choice': 'اختر' },
    };
    return names[lang][type] || type;
  }

  function playAudio(text, rateOverride) {
    const ok = speak(text, {
      voiceURI: settings.voiceURI || '',
      rate: rateOverride ?? settings.rate,
      onerror: () => toast(t(L, 'speechUnavailable')),
    });
    if (!ok) toast(t(L, 'speechUnavailable'));
  }

  function showHint(ex) {
    const existing = body.querySelector('.hint-box');
    if (existing) existing.remove();
    hintUsedSet.add(ex.id); // using a hint lowers the XP tier (see xp.js)
    let text;
    if (ex.type === 'listen-and-type') text = `${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'fill-blank') text = `${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'word-order') text = `${ex.words.length} ${t(L, 'words') || 'words'} — ${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'multiple-choice') text = ex.hint || `${t(L, 'meaning')}: ${ex.ar}`;
    if (ex.hint) text = `${ex.hint} — ${text}`;
    state.card.append(el('div', { class: 'hint-box', dir: 'auto' }, [iconLabel('bulb', text)]));
  }

  // ---------- checking ----------
  async function onCheck() {
    if (checked) { onNext(); return; }
    const ex = exercises[idx];
    let result;
    let typedVal = '';

    if (ex.type === 'listen-and-type') {
      const val = state.input?.value ?? '';
      typedVal = val;
      result = checkAnswer(val, ex.acceptedAnswers, { strict: settings.strictGrading });
      if (result.status === 'empty') { toast(t(L, 'emptyAnswer')); state.input?.classList.add('invalid'); return; }
      state.input?.classList.remove('invalid');
    } else if (ex.type === 'fill-blank') {
      const val = state.input?.value ?? '';
      typedVal = val;
      const base = checkAnswer(val, ex.acceptedAnswers, { strict: settings.strictGrading });
      result = { ...base, expectedDisplay: ex.blankWord };
      if (result.status === 'empty') { toast(t(L, 'emptyAnswer')); state.input?.classList.add('invalid'); return; }
      state.input?.classList.remove('invalid');
    } else if (ex.type === 'word-order') {
      const built = state.getWordOrder ? state.getWordOrder() : '';
      if (!state.wordOrderComplete || !state.wordOrderComplete()) {
        toast(t(L, 'wordOrderPrompt'));
        return;
      }
      result = checkAnswer(built, ex.acceptedAnswers || [ex.en], { strict: true });
    } else if (ex.type === 'multiple-choice') {
      const sel = state.getSelected ? state.getSelected() : -1;
      if (sel < 0) { toast(t(L, 'mcPrompt')); return; }
      const ok = sel === ex.answerIndex;
      result = { status: ok ? 'correct' : 'incorrect', diff: { word: 0, typed: '', expected: ex.options[ex.answerIndex] } };
      body.querySelectorAll('.mc-option').forEach((n, i) => {
        if (i === ex.answerIndex) n.classList.add('correct');
        else if (i === sel) n.classList.add('wrong');
      });
    }

    checked = true;
    lastResult = result;
    results[idx] = { status: result.status, ex, typedValue: typedVal };
    if (result.status === 'incorrect' || result.status === 'skipped') {
      firstAttemptMap.set(ex.id, false); // no first-try bonus after a failed attempt
    }

    // feedback UI (rendered inside the sentence card)
    const fb = el('div', { class: `feedback ${fbClass(result.status)}`, role: 'status' });
    const titles = {
      correct: t(L, 'correct'),
      minor: t(L, 'minorIssue'),
      incorrect: t(L, 'incorrect'),
      skipped: t(L, 'incorrect'),
    };
    fb.append(el('div', { class: 'fb-title' }, [iconLabel(result.status === 'correct' ? 'checkCircle' : result.status === 'minor' ? 'alert' : 'xCircle', titles[result.status])]));

    if (result.status !== 'correct') {
      const expected = ex.type === 'fill-blank' && result.expectedDisplay ? ex.display.replace('___', ex.blankWord) : ex.en;
      if (expected) fb.append(el('div', {}, [`${t(L, 'expectedAnswer')}: `, el('span', { class: 'expected', text: expected })]));
      if (ex.ar) fb.append(el('div', { class: 'ar-meaning', dir: 'rtl', text: `${t(L, 'meaning')}: ${ex.ar}` }));
      if (ex.type === 'listen-and-type' && typedVal && expected) {
        // word-level colored feedback: green = correct word, red = wrong, orange = missing
        fb.append(buildWordDiff(typedVal, expected));
      } else if (result.diff && result.diff.word > 0 && ex.type !== 'multiple-choice') {
        fb.append(el('div', { class: 'explain', text: `#${result.diff.word}: "${result.diff.typed}" → "${result.diff.expected}"` }));
      }
      if (ex.explanation) fb.append(el('div', { class: 'explain', text: ex.explanation }));
    } else if (ex.explanation) {
      fb.append(el('div', { class: 'explain', text: ex.explanation }));
    }
    // contextual motivational line (Arabic, {name}-aware, standalone dataset)
    const mMsg = result.status === 'correct'
      ? messageForCorrect(settings.userName, lastMotivation)
      : messageForWrong(settings.userName, lastMotivation);
    lastMotivation = mMsg;
    fb.append(el('div', { class: 'motivation-line', dir: 'rtl', text: mMsg }));

    // XP awarding (normal lessons only — revision sessions never award XP)
    if (!reviewMode) {
      try {
        const firstAttempt = firstAttemptMap.get(ex.id) !== false;
        if (result.status === 'incorrect') {
          if (firstAttempt) await markFirstAttemptFailed(ex.id); // zero-marker: retries can't claim the first-try bonus
        } else if (result.status === 'correct' || result.status === 'minor') {
          const award = await awardExercise(ex.id, result.status, { firstAttempt, usedHint: hintUsedSet.has(ex.id) });
          if (award.delta > 0) {
            sessionXp += award.delta;
            fb.append(el('span', { class: 'xp-gain', text: t(L, 'plusXp', { n: award.delta }) }));
            const xpMsg = messageForXp(settings.userName, lastMotivation);
            lastMotivation = xpMsg;
            toast(xpMsg, 2400);
          }
          // already-awarded exercises silently earn 0 again (ledger in xp.js)
        }
      } catch (err) { console.warn('xp award failed', err); }
    }

    state.feedbackBox.replaceChildren(fb);

    // sentence analysis word cards (listen & type / word order reveal the sentence)
    if (ex.type === 'listen-and-type' || ex.type === 'word-order') {
      try {
        const vocab = lesson && lesson.vocabulary ? lesson.vocabulary : [];
        const tokens = analyzeSentence(ex.en, vocab);
        if (tokens.some((tk) => tk.posAr || tk.meaningAr)) {
          state.card.append(el('div', { class: 'analysis-section' }, [
            el('div', { class: 'analysis-title', text: t(L, 'sentenceAnalysis') }),
            renderWordCards(tokens, {
              speak: (w) => playAudio(w, 0.8),
              labels: {
                meaning: t(L, 'meaning'), partOfSpeech: t(L, 'partOfSpeech'),
                unknown: t(L, 'notDetermined'), listen: t(L, 'play'), noAnalysis: t(L, 'noAnalysis'),
              },
            }),
          ]));
        }
      } catch { /* analysis is an extra; never block the lesson */ }
    }

    // persistence
    persistAnswer(ex, result.status);

    // flip buttons (lock actions that must not run twice)
    if (state.resetBtn) state.resetBtn.disabled = true;
    if (state.hintBtn) state.hintBtn.disabled = true;
    if (state.skipBtn) state.skipBtn.disabled = true;
    const nextBtn = el('button', { class: 'btn btn-primary', onclick: onNext }, [iconLabel(idx === exercises.length - 1 ? 'trophy' : 'arrowRight', idx === exercises.length - 1 ? t(L, 'finishLesson') : t(L, 'nextExercise'))]);
    state.checkBtn.replaceWith(nextBtn);
    nextBtn.focus();
  }

  /** Word-level colored diff chips for dictation feedback. */
  function buildWordDiff(typedVal, expected) {
    const wrap = el('div', { class: 'word-diff', dir: 'ltr' });
    try {
      const d = wordDiff(typedVal, expected);
      for (const tk of d.typed) wrap.append(el('span', { class: `wd-token wd-${tk.type}`, title: tk.expected || '', text: tk.text }));
      if (d.missing.length) {
        wrap.append(el('span', { class: 'wd-missing-label', text: t(L, 'missingWords') }));
        for (const m of d.missing) wrap.append(el('span', { class: 'wd-token wd-missing', text: m.text }));
      }
    } catch {
      wrap.append(el('span', { class: 'wd-token', text: expected }));
    }
    return wrap;
  }

  function fbClass(status) {
    return { correct: 'ok', minor: 'minor', incorrect: 'bad', skipped: 'bad' }[status] || 'bad';
  }

  async function persistAnswer(ex, status) {
    const timeMs = Date.now() - exStart;
    try {
      await recordAttempt({
        lessonId: ex.lessonId,
        exerciseId: ex.id,
        type: ex.type,
        status,
        timeMs,
        tags: ex.grammarTags || [],
      });
      if (reviewMode) {
        await gradeReview(ex.id, status === 'correct' || status === 'minor');
      } else {
        if (status === 'incorrect' || status === 'skipped') {
          await upsertOnWrong(ex.id, ex.lessonId, ex.grammarTags || []);
        }
        // retry sessions map back to the ORIGINAL exercise index so
        // lesson state keeps a single consistent key space
        await updateLessonState(ex.lessonId, {
          totalExercises: retryMode ? originalCount : exercises.length,
          index: retryMode ? (ex.origIdx ?? idx) : idx,
          status,
        });
      }
    } catch (err) {
      console.warn('progress save failed', err);
    }
  }

  function onSkip() {
    if (checked) { onNext(); return; }
    const ex = exercises[idx];
    if (typeof confirm !== 'undefined' && !confirm(t(L, 'skipConfirm'))) return;
    checked = true;
    results[idx] = { status: 'skipped', ex, typedValue: '' };
    firstAttemptMap.set(ex.id, false);
    const fb = el('div', { class: 'feedback bad' }, [
      el('div', { class: 'fb-title' }, [iconLabel('arrowRight', t(L, 'skip'))]),
      el('div', {}, [`${t(L, 'expectedAnswer')}: `, el('span', { class: 'expected', text: ex.en })]),
      ex.ar ? el('div', { class: 'ar-meaning', dir: 'rtl', text: ex.ar }) : null,
    ]);
    state.feedbackBox.replaceChildren(fb);
    persistAnswer(ex, 'skipped');
    if (state.resetBtn) state.resetBtn.disabled = true;
    if (state.hintBtn) state.hintBtn.disabled = true;
    state.checkBtn.replaceWith(el('button', { class: 'btn btn-primary', onclick: onNext }, [iconLabel('arrowRight', t(L, 'nextExercise'))]));
  }

  function onNext() {
    stopSpeaking();
    if (idx < exercises.length - 1) {
      idx += 1;
      renderExercise();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      renderSummary();
    }
  }

  // ---------- summary ----------
  async function renderSummary() {
    const attempted = results.filter(Boolean);
    const good = attempted.filter((r) => r.status === 'correct').length;
    const minor = attempted.filter((r) => r.status === 'minor').length;
    const bad = attempted.filter((r) => r.status === 'incorrect').length;
    const skipped = attempted.filter((r) => r.status === 'skipped').length;
    const acc = attempted.length ? Math.round(((good + minor) / attempted.length) * 100) : 0;
    const mins = Math.max(1, Math.round((Date.now() - sessionStart) / 60000));
    const wrongs = attempted.filter((r) => r.status === 'incorrect' || r.status === 'skipped');

    // one-time lesson-completion bonus (ledger in xp.js makes this safe to call)
    if (!reviewMode && !retryMode) {
      try {
        const bonus = await awardLessonComplete(lessonId);
        sessionXp += bonus.delta;
      } catch { /* XP is never on the critical path */ }
    }
    let totalXp = 0;
    try { totalXp = await getTotalXp(); } catch { /* stays 0 */ }

    renderHead();
    body.replaceChildren();

    // difficult words, taken only from the user's real wrong answers
    const wordFreq = new Map();
    const bump = (w) => {
      const k = String(w || '').toLowerCase().replace(/[^a-z0-9'-]/g, '');
      if (k) wordFreq.set(k, (wordFreq.get(k) || 0) + 1);
    };
    for (const r of wrongs) {
      if (r.ex.type === 'listen-and-type' && r.typedValue) {
        try {
          const d = wordDiff(r.typedValue, r.ex.en);
          for (const tk of d.typed) if (tk.type === 'wrong' && tk.expected) bump(tk.expected);
          for (const m of d.missing) bump(m.text);
        } catch { /* ignore */ }
      } else if (r.ex.type === 'fill-blank') {
        bump(r.ex.blankWord);
      }
    }
    const difficultWords = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

    const completeMsg = messageForLessonComplete(settings.userName, lastMotivation);
    lastMotivation = completeMsg;
    const doneTitle = reviewMode ? t(L, 'reviewSessionDone') : (retryMode ? t(L, 'retryDoneTitle') : t(L, 'lessonComplete'));

    body.append(el('div', { class: 'done-card center' }, [
      el('div', { class: 'done-medal' }, [icon(acc >= 80 ? 'trophy' : 'flame')]),
      el('h3', { text: doneTitle }),
      el('div', { class: 'motivation-line', dir: 'rtl', text: completeMsg }),
      el('div', { class: 'summary-score', text: `${acc}%` }),
      el('div', { class: 'muted', text: t(L, 'yourScore') }),
      el('div', { class: 'summary-rows' }, [
        rowStat(t(L, 'resultsQuestions'), String(attempted.length)),
        rowStat(t(L, 'correctAnswers'), `${good + minor}`),
        rowStat(t(L, 'resultsWrong'), `${bad + skipped}`),
        rowStat(t(L, 'timeSpent'), `${mins} ${t(L, 'minutes')}`),
        rowStat(t(L, 'xpThisSession'), `+${formatXp(sessionXp)}`),
        rowStat(t(L, 'xpTotal'), formatXp(totalXp)),
      ]),
      difficultWords.length ? el('div', { class: 'difficult-words' }, [
        el('div', { class: 'small muted', style: { marginBottom: '.35rem' }, text: t(L, 'difficultWords') }),
        el('div', { class: 'wd-chips', dir: 'ltr' }, difficultWords.map((w) => el('span', { class: 'wd-token wd-missing', text: w }))),
      ]) : null,
      (!reviewMode && !retryMode && wrongs.length) ? el('p', { class: 'muted small', style: { marginTop: '.6rem' }, text: t(L, 'addedToReview') }) : null,
      el('div', { class: 'card-actions', style: { marginTop: '1.1rem' } }, buildSummaryButtons(wrongs)),
    ].filter(Boolean)));

    function formatXp(n) {
      return new Intl.NumberFormat(L === 'ar' ? 'ar-EG' : 'en-US').format(n);
    }

    function rowStat(k, v) {
      return el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: k }), el('b', { text: v })]);
    }

    function buildSummaryButtons(wrongList) {
      const btns = [];
      if (!reviewMode) {
        if (wrongList.length && !retryMode) {
          btns.push(el('button', { class: 'btn', onclick: startRetrySession }, [iconLabel('review', `${t(L, 'retryMistakes')} (${wrongList.length})`)]));
        }
        const nextId = nextLessonInSection(lessonId);
        btns.push(el('button', {
          class: 'btn btn-primary',
          onclick: () => nextId ? navigate('lesson', [nextId]) : navigate('section', [lesson.section]),
        }, [iconLabel(nextId ? 'arrowRight' : 'books', nextId ? t(L, 'nextLesson') : t(L, 'backToSection'))]));
        btns.push(el('a', { class: 'btn', href: `#/section/${lesson.section}` }, [iconLabel('grid', t(L, 'backToSection'))]));
      } else {
        btns.push(el('button', { class: 'btn btn-primary', onclick: () => navigate('review') }, [iconLabel('review', t(L, 'navReview'))]));
      }
      return btns;
    }
  }

  /** Re-run only the exercises answered wrong/skipped in this session. */
  function startRetrySession() {
    const wrongItems = results
      .filter((r) => r && (r.status === 'incorrect' || r.status === 'skipped'))
      .map((r) => r.ex);
    if (!wrongItems.length) return;
    originalCount = exercises.length;
    exercises = wrongItems.map((w) => ({
      ...w,
      origIdx: w.origIdx ?? originalExercises.findIndex((o) => o.id === w.id),
    }));
    idx = 0;
    retryMode = true;
    results = new Array(exercises.length).fill(null);
    sessionStart = Date.now();
    sessionXp = 0; // retries earn nothing new — the XP ledger forbids double awards
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderExercise();
  }

  renderExercise();
}

/** Error state with friendly message + home button. */
export function renderErrorState(container, lang, err) {
  const L = lang || 'en';
  console.error('lesson error:', err);
  container.replaceChildren(el('div', { class: 'state-box' }, [
    el('div', { class: 'big' }, [icon('alert')]),
    el('h3', { text: t(L, 'errorTitle') }),
    el('p', { text: err && err.message ? err.message : t(L, 'lessonError') }),
    el('a', { class: 'btn btn-primary mt', href: '#/', text: t(L, 'errorBack') }),
  ]));
}
