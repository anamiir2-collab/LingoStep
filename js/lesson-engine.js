/* ============================================================
   LingoStep — lesson-engine.js
   Renders the lesson player: exercises (listen-and-type,
   fill-blank, word-order, multiple-choice), audio controls,
   feedback, progress, resume, completion summary.
   Also powers revision sessions (opts.reviewMode).
   ============================================================ */

import { el, toast } from './utils.js';
import { t } from './i18n.js';
import { getSettings } from './settings.js';
import { checkAnswer } from './grading.js';
import { speak, stopSpeaking, isSupported as speechSupported } from './speech.js';
import { recordAttempt, updateLessonState, saveResume, getLessonState } from './progress.js';
import { upsertOnWrong, gradeReview } from './review.js';
import { navigate } from './router.js';
import { getManifestEntry, nextLessonInSection, loadLesson } from './lesson-loader.js';

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
      el('div', { class: 'big', text: '📭' }),
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
  const results = new Array(exercises.length).fill(null);

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
    const crumb = reviewMode
      ? el('div', { class: 'breadcrumb' }, [
          el('a', { href: '#/review', text: t(L, 'navReview') }),
          ' › ',
          el('span', { text: t(L, 'reviewMode') }),
        ])
      : el('div', { class: 'breadcrumb' }, [
          el('a', { href: '#/', text: t(L, 'navHome') }),
          ' › ',
          el('a', { href: `#/section/${lesson.section}`, text: sectionLabel(lesson.section, L) }),
        ]);

    const title = reviewMode
      ? t(L, 'reviewTitle')
      : `${lesson.title} — ${lesson.titleAr}`;
    const sub = reviewMode
      ? `${exercises.length - idx} ${t(L, 'remaining')}`
      : `${t(L, 'level')}: ${lesson.level} · ~${lesson.estimatedMinutes} ${t(L, 'minutes')} · ${lesson.objectives[0] || ''}`;

    head.append(
      crumb,
      el('div', { class: 'row-between' }, [
        el('div', { class: 'grow' }, [
          el('h2', { text: title }),
          el('div', { class: 'sub', text: sub }),
        ]),
        el('button', {
          class: 'btn btn-ghost btn-sm',
          text: `✕ ${t(L, reviewMode ? 'exitReview' : 'exitLesson')}`,
          onclick: confirmExit,
        }),
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
    renderHead();
    body.replaceChildren();

    const ex = exercises[idx];
    const doneCount = results.filter((r) => r && rank[r.status] >= rank.minor).length;

    // progress row
    const progressPct = Math.round(((idx) / exercises.length) * 100);
    body.append(
      el('div', { class: 'ex-progress' }, [
        el('span', { class: 'ex-counter', text: `${idx + 1} ${t(L, 'ofExercises')} ${exercises.length}` }),
        el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': progressPct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, [
          el('span', { style: { width: `${progressPct}%` } }),
        ]),
      ]),
      el('div', { class: 'row', style: { marginBottom: '.7rem' } }, [
        el('span', { class: 'chip chip-level', text: `${t(L, 'exercise')} ${idx + 1}` }),
        el('span', { class: 'chip', text: typeLabel(ex.type, L) }),
        ...(doneCount ? [el('span', { class: 'chip chip-done', text: `${doneCount} ✓` })] : []),
      ]),
    );

    const card = el('div', { class: 'sentence-card' });
    body.append(card);

    const inputRow = el('div', { class: 'answer-row' });
    const feedbackBox = el('div');
    const controls = el('div', { class: 'row', style: { marginTop: '.9rem', justifyContent: 'center' } });
    state.feedbackBox = feedbackBox;
    body.append(inputRow, feedbackBox, controls);

    const checkBtn = el('button', {
      class: 'btn btn-primary',
      text: `✓ ${t(L, 'checkAnswer')}`,
      onclick: () => onCheck(),
    });
    const skipBtn = el('button', { class: 'btn btn-ghost btn-sm', text: t(L, 'skip'), onclick: onSkip });
    state.checkBtn = checkBtn;
    const hintBtn = el('button', { class: 'btn btn-ghost btn-sm', text: `💡 ${t(L, 'hint')}`, onclick: () => showHint(ex) });

    if (ex.type === 'listen-and-type') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'typeWhatYouHear') }));
      const audioRow = el('div', { class: 'audio-row' });
      const listenBtn = el('button', { class: 'btn', text: `🔊 ${t(L, 'play')}`, onclick: () => playAudio(ex.en) });
      const slowBtn = el('button', { class: 'btn btn-ghost', text: `🐢 ${t(L, 'playSlow')}`, onclick: () => playAudio(ex.en, 0.65) });
      audioRow.append(listenBtn, slowBtn);
      if (!speechSupported()) {
        audioRow.append(el('p', { class: 'muted small', text: t(L, 'speechUnavailable') }));
        // If speech is unavailable, show the sentence so the exercise stays usable.
        card.append(el('div', { class: 'sentence-text', text: ex.en }));
      } else {
        card.append(audioRow);
        setTimeout(() => playAudio(ex.en), 250); // auto-play once per exercise
      }
      if (settings.showArabic && ex.ar) {
        card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));
      }
      const input = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t(L, 'typeWhatYouHear'), placeholder: '…' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checked ? onNext() : onCheck(); } });
      inputRow.append(input, checkBtn, hintBtn, skipBtn);
      setTimeout(() => input.focus(), 120);
      state.input = input;
    }

    if (ex.type === 'fill-blank') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'fillPrompt') }));
      card.append(el('div', { class: 'blank-display', html: trustedBlankHtml(ex.display) }));
      if (settings.showArabic && ex.ar) card.append(el('div', { class: 'sentence-ar', dir: 'rtl', text: ex.ar }));
      const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t(L, 'fillPrompt'), placeholder: '…' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checked ? onNext() : onCheck(); } });
      inputRow.append(input, checkBtn, hintBtn, skipBtn);
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
      inputRow.append(clearBtn, checkBtn, hintBtn, skipBtn);
      state.getWordOrder = () => placed.map((p) => p.w).join(' ');
      state.wordOrderComplete = () => placed.length === ex.words.length;
    }

    if (ex.type === 'multiple-choice') {
      card.append(el('div', { class: 'prompt-label', text: t(L, 'mcPrompt') }));
      card.append(el('div', { class: 'sentence-text', text: ex.question }));
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
      inputRow.append(checkBtn, skipBtn);
      state.getSelected = () => selected;
    }

    controls.append(el('span', { class: 'muted small', text: '⏎ = Check / Next' }));
    if (!reviewMode && entry) {
      // keep resume position fresh
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
    let text;
    if (ex.type === 'listen-and-type') text = `${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'fill-blank') text = `${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'word-order') text = `${ex.words.length} ${t(L, 'words') || 'words'} — ${t(L, 'meaning')}: ${ex.ar}`;
    else if (ex.type === 'multiple-choice') text = ex.hint || `${t(L, 'meaning')}: ${ex.ar}`;
    if (ex.hint) text = `${ex.hint} — ${text}`;
    body.append(el('div', { class: 'hint-box', dir: 'auto', text: `💡 ${text}` }));
  }

  // ---------- checking ----------
  function onCheck() {
    if (checked) { onNext(); return; }
    const ex = exercises[idx];
    let result;

    if (ex.type === 'listen-and-type') {
      const val = state.input?.value ?? '';
      result = checkAnswer(val, ex.acceptedAnswers, { strict: settings.strictGrading });
      if (result.status === 'empty') { toast(t(L, 'emptyAnswer')); state.input?.classList.add('invalid'); return; }
      state.input?.classList.remove('invalid');
    } else if (ex.type === 'fill-blank') {
      const val = state.input?.value ?? '';
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
    results[idx] = { status: result.status, ex };

    // feedback UI
    const fb = el('div', { class: `feedback ${fbClass(result.status)}`, role: 'status' });
    const titles = {
      correct: t(L, 'correct'),
      minor: t(L, 'minorIssue'),
      incorrect: t(L, 'incorrect'),
      skipped: t(L, 'incorrect'),
    };
    fb.append(el('div', { class: 'fb-title', text: `${result.status === 'correct' ? '🎉' : result.status === 'minor' ? '🟡' : '❌'} ${titles[result.status]}` }));

    if (result.status !== 'correct') {
      const expected = ex.type === 'fill-blank' && result.expectedDisplay ? ex.display.replace('___', ex.blankWord) : ex.en;
      if (expected) fb.append(el('div', {}, [`${t(L, 'expectedAnswer')}: `, el('span', { class: 'expected', text: expected })]));
      if (ex.ar) fb.append(el('div', { class: 'ar-meaning', dir: 'rtl', text: `${t(L, 'meaning')}: ${ex.ar}` }));
      if (result.diff && result.diff.word > 0 && ex.type !== 'multiple-choice') {
        fb.append(el('div', { class: 'explain', text: `#${result.diff.word}: "${result.diff.typed}" → "${result.diff.expected}"` }));
      }
      if (ex.explanation) fb.append(el('div', { class: 'explain', text: ex.explanation }));
      if (ex.type === 'listen-and-type' && result.status === 'incorrect') {
        // reveal the sentence for study after a wrong dictation attempt
        fb.append(el('div', { class: 'explain', text: `${ex.en}` }));
      }
    } else if (ex.explanation) {
      fb.append(el('div', { class: 'explain', text: ex.explanation }));
    }
    state.feedbackBox.replaceChildren(fb);

    // persistence
    persistAnswer(ex, result.status);

    // flip buttons
    const nextBtn = el('button', { class: 'btn btn-primary', text: `${idx === exercises.length - 1 ? '🏁' : '→'} ${idx === exercises.length - 1 ? t(L, 'finishLesson') : t(L, 'nextExercise')}`, onclick: onNext });
    state.checkBtn.replaceWith(nextBtn);
    nextBtn.focus();
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
        await updateLessonState(ex.lessonId, { totalExercises: exercises.length, index: idx, status });
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
    results[idx] = { status: 'skipped', ex };
    const fb = el('div', { class: 'feedback bad' }, [
      el('div', { class: 'fb-title', text: `⏭ ${t(L, 'skip')}` }),
      el('div', {}, [`${t(L, 'expectedAnswer')}: `, el('span', { class: 'expected', text: ex.en })]),
      ex.ar ? el('div', { class: 'ar-meaning', dir: 'rtl', text: ex.ar }) : null,
    ]);
    state.feedbackBox.replaceChildren(fb);
    persistAnswer(ex, 'skipped');
    state.checkBtn.replaceWith(el('button', { class: 'btn btn-primary', text: `→ ${t(L, 'nextExercise')}`, onclick: onNext }));
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
  function renderSummary() {
    const attempted = results.filter(Boolean);
    const good = attempted.filter((r) => r.status === 'correct').length;
    const minor = attempted.filter((r) => r.status === 'minor').length;
    const skipped = attempted.filter((r) => r.status === 'skipped').length;
    const acc = attempted.length ? Math.round(((good + minor) / attempted.length) * 100) : 0;
    const mins = Math.max(1, Math.round((Date.now() - sessionStart) / 60000));

    renderHead();
    body.replaceChildren();

    const wrongs = attempted.filter((r) => r.status === 'incorrect' || r.status === 'skipped');

    body.append(el('div', { class: 'card center' }, [
      el('div', { class: 'state-box', style: { padding: '1rem 0' } }, [
        el('div', { class: 'big', text: acc >= 80 ? '🎉' : '💪' }),
        el('h3', { text: reviewMode ? t(L, 'reviewSessionDone') : t(L, 'lessonComplete') }),
      ]),
      el('div', { class: 'summary-score', text: `${acc}%` }),
      el('div', { class: 'muted', text: t(L, 'yourScore') }),
      el('div', { class: 'summary-rows' }, [
        rowStat(t(L, 'correctAnswers'), `${good + minor} / ${attempted.length}`),
        rowStat(t(L, 'timeSpent'), `${mins} ${t(L, 'minutes')}`),
        wrongs.length ? rowStat(t(L, 'wrongOnes'), String(wrongs.length)) : null,
      ].filter(Boolean)),
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '1.1rem' } }, buildSummaryButtons(wrongs)),
    ]));

    function rowStat(k, v) {
      return el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: k }), el('b', { text: v })]);
    }

    function buildSummaryButtons(wrongList) {
      const btns = [];
      if (!reviewMode) {
        const nextId = nextLessonInSection(lessonId);
        btns.push(el('button', {
          class: 'btn btn-primary',
          text: `${nextId ? '→ ' : ''}${nextId ? t(L, 'nextLesson') : t(L, 'backToSection')}`,
          onclick: () => nextId ? navigate('lesson', [nextId]) : navigate('section', [lesson.section]),
        }));
        btns.push(el('a', { class: 'btn', href: `#/section/${lesson.section}`, text: t(L, 'backToSection') }));
      } else {
        btns.push(el('button', { class: 'btn btn-primary', text: t(L, 'navReview'), onclick: () => navigate('review') }));
      }
      return btns;
    }
  }

  renderExercise();
}

/** Error state with friendly message + home button. */
export function renderErrorState(container, lang, err) {
  const L = lang || 'en';
  console.error('lesson error:', err);
  container.replaceChildren(el('div', { class: 'state-box' }, [
    el('div', { class: 'big', text: '⚠️' }),
    el('h3', { text: t(L, 'errorTitle') }),
    el('p', { text: err && err.message ? err.message : t(L, 'lessonError') }),
    el('a', { class: 'btn btn-primary mt', href: '#/', text: t(L, 'errorBack') }),
  ]));
}
