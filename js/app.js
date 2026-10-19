/* ============================================================
   LingoStep — app.js
   Application shell + views: dashboard, section list, review hub,
   statistics, settings. Wires router, settings, i18n, SW updates.
   ============================================================ */

import { el, $, pct, formatDuration } from './utils.js';
import { t } from './i18n.js';
import { getSettings, saveSettings, applyDocumentSettings } from './settings.js';
import { start as startRouter, onChange, navigate, docTitle } from './router.js';
import { getManifest, getManifestBySection } from './lesson-loader.js';
import { renderLessonPlayer, renderErrorState } from './lesson-engine.js';
import { getOverview, getToday, getDailyHistory, getAllLessonStates, exportBackup, importBackup, clearAllProgress } from './progress.js';
import { dueCount, dueItems, availableTags, totalCount as reviewTotalCount } from './review.js';
import { isSupported as speechSupported, loadVoices, englishVoices, speak } from './speech.js';

const SECTIONS_META = [
  { id: 'basics', icon: '🧱', en: 'Basics & Sentence Structure', ar: 'الأساسيات وبناء الجملة', descEn: 'SVO order, pronouns, articles, plurals, adjectives, prepositions', descAr: 'ترتيب الجملة، الضمائر، أدوات التعريف، الجمع، الصفات، حروف الجر' },
  { id: 'tenses', icon: '⏳', en: 'English 16 Tenses Mastery', ar: 'إتقان الأزمنة الستة عشر', descEn: 'All 16 tense/aspect forms with clear contrast practice', descAr: 'كل صيغ الأزمنة الستة عشر مع تدريب مقارن واضح' },
  { id: 'grammar', icon: '🧩', en: 'Grammar, Questions & Negation', ar: 'القواعد والأسئلة والنفي', descEn: 'Questions, modals, conditionals, passive, reported speech', descAr: 'الأسئلة، الأفعال الناقصة، الشرط، المبني للمجهول، الكلام المنقول' },
  { id: 'conversations', icon: '💬', en: 'Daily English Conversations', ar: 'المحادثات اليومية', descEn: 'Greetings, family, shopping, food, phone calls, opinions', descAr: 'التحيات، العائلة، التسوق، الطعام، الهاتف، آراء وتفضيلات' },
  { id: 'practical-scenarios', icon: '🧭', en: 'Travel, Work & Practical Situations', ar: 'السفر والعمل والمواقف العملية', descEn: 'Airports, hotels, directions, meetings, interviews, emergencies', descAr: 'المطارات، الفنادق، الاتجاهات، الاجتماعات، المقابلات، الطوارئ' },
  { id: 'vocabulary', icon: '📚', en: 'Vocabulary & Common Expressions', ar: 'المفردات والتعبيرات الشائعة', descEn: 'High-frequency words, phrasal verbs, collocations, idioms', descAr: 'مفردات شائعة، أفعال مركبة، متلازمات لفظية، تعبيرات اصطلاحية' },
  { id: 'listening-writing', icon: '🎧', en: 'Listening, Dictation & Writing', ar: 'الاستماع والإملاء والكتابة', descEn: 'Dictation, paragraphs, punctuation, correction, reordering', descAr: 'إملاء، فقرات قصيرة، ترقيم، تصحيح، ترتيب الكلمات' },
];

let appRoot = null;
let currentLang = 'en';

/* ============================================================
   Boot
   ============================================================ */

async function boot() {
  appRoot = $('#app');
  const settings = getSettings();
  currentLang = settings.lang;
  applyDocumentSettings(settings);

  renderShell();
  onChange((route) => handleRoute(route));
  startRouter();

  // voices preload (best effort)
  if (speechSupported()) loadVoices();

  // service worker registration (PWA / offline)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            import('./utils.js').then(({ toast }) => toast(t(currentLang, 'updateReady'), 6000));
          }
        });
      });
    } catch { /* offline features disabled; app still works */ }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    import('./utils.js').then(({ toast }) => toast(t(currentLang, 'networkOffline'), 4000));
  }
}

function renderShell() {
  const L = currentLang;
  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'header-inner' }, [
      el('a', { class: 'brand', href: '#/' }, [
        el('span', { class: 'brand-badge', text: 'L', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'LingoStep' }),
      ]),
      el('nav', { class: 'main-nav', 'aria-label': 'Main' }, [
        navLink('navHome', '#/', 'home'),
        navLink('navReview', '#/review', 'review'),
        navLink('navStats', '#/stats', 'stats'),
        navLink('navSettings', '#/settings', 'settings'),
      ]),
      el('button', { class: 'icon-btn', title: t(L, 'interfaceLanguage'), 'aria-label': t(L, 'interfaceLanguage'), text: L === 'ar' ? 'EN' : 'ع', onclick: toggleLanguage }),
      el('button', { class: 'icon-btn', title: t(L, 'theme'), 'aria-label': t(L, 'theme'), text: '◐', onclick: cycleTheme }),
    ]),
  ]);

  const main = el('main', { class: 'app-main', id: 'view' });
  const footer = el('footer', { class: 'app-footer' }, [
    el('span', { text: t(L, 'footerNote') }),
  ]);

  // Mobile floating navigation inspired by the supplied reference.
  const mobileNav = el('nav', { class: 'mobile-bottom-nav', 'aria-label': L === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation' }, [
    el('span', { class: 'mobile-nav-indicator', 'aria-hidden': 'true' }),
    mobileNavLink('navHome', '#/', 'home', '⌂'),
    mobileNavLink('navReview', '#/review', 'review', '↻'),
    mobileNavLink('navStats', '#/stats', 'stats', '▥'),
    mobileNavLink('navSettings', '#/settings', 'settings', '⚙'),
  ]);

  appRoot.replaceChildren(header, main, footer, mobileNav);
}

function navLink(labelKey, href, routeName) {
  const a = el('a', { class: 'nav-link', href, text: t(currentLang, labelKey), 'data-route': routeName });
  return a;
}

function mobileNavLink(labelKey, href, routeName, icon) {
  return el('a', {
    class: 'mobile-nav-link',
    href,
    'aria-label': t(currentLang, labelKey),
    'data-route': routeName,
  }, [
    el('span', { class: 'mobile-nav-icon', text: icon, 'aria-hidden': 'true' }),
    el('span', { class: 'mobile-nav-label', text: t(currentLang, labelKey) }),
  ]);
}

function updateNavState(routeName) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    if (a.dataset.route === routeName) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // Lesson and section screens belong to the Home destination.
  const mobileRoute = ['section', 'lesson'].includes(routeName) ? 'home' : routeName;
  const mobileLinks = [...document.querySelectorAll('.mobile-nav-link')];
  let activeIndex = 0;
  mobileLinks.forEach((a, index) => {
    const active = a.dataset.route === mobileRoute;
    if (active) activeIndex = index;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const indicator = document.querySelector('.mobile-nav-indicator');
  if (indicator) indicator.style.left = `${((activeIndex + 0.5) / mobileLinks.length) * 100}%`;
}

function toggleLanguage() {
  const next = currentLang === 'ar' ? 'en' : 'ar';
  saveSettings({ lang: next });
  currentLang = next;
  applyDocumentSettings();
  renderShell();
  onChangeRerun();
}

function cycleTheme() {
  const cur = getSettings().theme;
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(cur) + 1) % order.length];
  saveSettings({ theme: next });
  applyDocumentSettings();
  import('./utils.js').then(({ toast }) =>
    toast(next === 'light' ? '☀️ light' : next === 'dark' ? '🌙 dark' : '🖥 system', 1400));
}

function onChangeRerun() {
  // re-render current route with new language
  const parsed = { name: (location.hash.replace(/^#\//, '').split('/')[0]) || 'home', params: location.hash.split('/').slice(1) };
  handleRoute({ name: parsed.name === '' ? 'home' : parsed.name, params: parsed.params.map((p) => decodeURIComponent(p.split('?')[0])) });
}

/* ============================================================
   Router → views
   ============================================================ */

async function handleRoute(route) {
  const view = document.getElementById('view');
  if (!view) return;
  window.scrollTo(0, 0);
  updateNavState(route.name);

  try {
    if (route.name === 'home') return await viewDashboard(view);
    if (route.name === 'section') return await viewSection(view, route.params[0]);
    if (route.name === 'lesson') return await viewLesson(view, route.params[0]);
    if (route.name === 'review') return await viewReview(view);
    if (route.name === 'stats') return await viewStats(view);
    if (route.name === 'settings') return await viewSettings(view);
    return await viewDashboard(view);
  } catch (err) {
    renderErrorState(view, currentLang, err);
  }
}

function loading(view) {
  view.replaceChildren(el('div', { class: 'state-box' }, [
    el('div', { class: 'spinner', role: 'status' }),
    el('p', { text: t(currentLang, 'loading') }),
  ]));
}

/* ============================================================
   Dashboard
   ============================================================ */

async function viewDashboard(view) {
  loading(view);
  docTitle('navHome');
  const L = currentLang;
  const [overview, today, states, due] = await Promise.all([
    getOverview(), getToday(), getAllLessonStates(), dueCount(),
  ]);
  const manifest = getManifest();
  const settings = getSettings();

  const goalPct = pct(today.count, settings.dailyGoal);

  const hero = el('section', { class: 'hero' }, [
    el('h1', { text: overview.totalAnswers > 0 ? `${t(L, 'welcome')} 👋` : `${t(L, 'welcomeNew')} 👋` }),
    el('p', { text: t(L, 'heroText') }),
    el('div', { class: 'row' }, [
      overview.lastLessonId
        ? el('a', { class: 'btn', href: `#/lesson/${overview.lastLessonId}`, text: `▶ ${t(L, 'continueLearning')}` })
        : el('a', { class: 'btn', href: `#/section/basics`, text: `▶ ${t(L, 'startLearning')}` }),
      el('a', { class: 'btn btn-ghost', style: { color: '#fff', borderColor: 'rgba(255,255,255,.5)' }, href: '#/review', text: `🔁 ${t(L, 'quickReview')}` }),
    ]),
  ]);

  // stats
  const statGrid = el('div', { class: 'stat-grid mb' }, [
    statCard(overview.completedLessons, t(L, 'completedLessons')),
    statCard(formatNumber(overview.totalAnswers), t(L, 'practicedSentences')),
    statCard(`${overview.accuracy}%`, t(L, 'accuracy')),
    statCard(overview.streak, `${t(L, 'streakDays')} 🔥`),
  ]);

  // daily goal card
  const goalCard = el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: t(L, 'dailyGoal') }),
    el('div', { class: 'goal-wrap' }, [
      el('div', { class: 'goal-ring', style: { '--pct': String(goalPct) }, role: 'img', 'aria-label': `${goalPct}%` }, [
        el('div', { class: 'goal-ring-inner', text: `${today.count}/${settings.dailyGoal}` }),
      ]),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row-between' }, [
          el('span', { text: `${today.count} ${t(L, 'goalDoneToday')}` }),
          el('span', { class: 'muted small', text: `${goalPct}%` }),
        ]),
        el('div', { class: 'progress', style: { marginTop: '.45rem' } }, [el('span', { style: { width: `${Math.min(100, goalPct)}%` } })]),
        el('p', { class: 'muted small', text: t(L, 'installHint') }),
      ]),
    ]),
  ]);

  // revision quick access
  const reviewCard = el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('h3', { class: 'card-title', style: { margin: 0 }, text: t(L, 'quickReview') }),
        el('span', { class: due > 0 ? 'chip chip-due' : 'chip', text: due > 0 ? `${due} ${t(L, 'reviewDue')}` : t(L, 'nothingDue') }),
      ]),
      el('a', { class: 'btn btn-sm', href: '#/review', text: `🔁 ${t(L, 'startReview')}` }),
    ]),
  ]);

  // sections
  const sectionHead = el('div', { class: 'section-head' }, [
    el('h2', { text: t(L, 'yourSections') }),
  ]);
  const grid = el('div', { class: 'section-grid' });
  for (const meta of SECTIONS_META) {
    const list = manifest.filter((l) => l.section === meta.id);
    const sentences = list.reduce((s, l) => s + (l.exercises || 0), 0);
    const done = list.filter((l) => states[l.id]?.completed).length;
    const donePct = pct(done, list.length);
    grid.append(el('a', { class: 'section-card', href: `#/section/${meta.id}` }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'section-icon', text: meta.icon }),
        el('div', {}, [
          el('h3', { text: L === 'ar' ? meta.ar : meta.en }),
          el('div', { class: 'sub', text: `${list.length} ${t(L, 'lessons')} · ${formatNumber(sentences)} ${t(L, 'sentences')}` }),
        ]),
      ]),
      el('div', { class: 'progress' }, [el('span', { style: { width: `${donePct}%` } })]),
      el('div', { class: 'row-between small muted' }, [
        el('span', { text: `${done}/${list.length} ${t(L, 'markDone')}` }),
        el('span', { text: `${donePct}%` }),
      ]),
    ]));
  }

  view.replaceChildren(hero, statGrid, goalCard, reviewCard, sectionHead, grid);
}

function statCard(value, label) {
  return el('div', { class: 'stat-card' }, [
    el('div', { class: 'stat-value', text: String(value) }),
    el('div', { class: 'stat-label', text: label }),
  ]);
}

function formatNumber(n) {
  return new Intl.NumberFormat(currentLang === 'ar' ? 'ar-EG' : 'en-US').format(n);
}

/* ============================================================
   Section view
   ============================================================ */

async function viewSection(view, sectionId) {
  loading(view);
  const L = currentLang;
  const meta = SECTIONS_META.find((s) => s.id === sectionId);
  if (!meta) { navigate('home'); return; }
  docTitle(L === 'ar' ? meta.ar : meta.en);

  const list = getManifestBySection(sectionId);
  const states = await getAllLessonStates();
  const sectionSentences = list.reduce((s, l) => s + (l.exercises || 0), 0);
  const doneCountAll = list.filter((l) => states[l.id]?.completed).length;

  const items = el('div', { class: 'lesson-list' });
  list.forEach((entry, i) => {
    const st = states[entry.id];
    const cls = st?.completed ? 'done' : (st && Object.keys(st.attempted || {}).length ? 'active' : '');
    items.append(el('a', { class: `lesson-item ${cls}`, href: `#/lesson/${entry.id}` }, [
      el('span', { class: 'lesson-num', text: st?.completed ? '✓' : String(i + 1) }),
      el('div', { class: 'lesson-titles' }, [
        el('div', { class: 't', text: entry.title }),
        el('div', { class: 's', text: `${entry.titleAr} · ${entry.level} · ${entry.exercises} ${t(L, 'exercises')}` }),
      ]),
      el('span', { class: `chip ${st?.completed ? 'chip-done' : 'chip'}`, text: st?.completed ? t(L, 'markDone') : `${pct(Object.keys(st?.attempted || {}).length, entry.exercises)}%` }),
    ]));
  });

  view.replaceChildren(
    el('div', { class: 'breadcrumb' }, [el('a', { href: '#/', text: t(L, 'navHome') }), ' › ', el('span', { text: L === 'ar' ? meta.ar : meta.en })]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('span', { class: 'section-icon', text: meta.icon })]),
      el('h2', { text: L === 'ar' ? meta.ar : meta.en, style: { margin: '.4rem 0' } }),
      el('p', { class: 'muted', text: L === 'ar' ? meta.descAr : meta.descEn }),
      el('div', { class: 'progress mt' }, [el('span', { style: { width: `${pct(doneCountAll, list.length)}%` } })]),
      el('p', { class: 'small muted', text: `${doneCountAll}/${list.length} ${t(L, 'lessons')} · ${formatNumber(sectionSentences)} ${t(L, 'sentences')}` }),
    ]),
    el('div', { class: 'mt' }),
    items,
  );
}

/* ============================================================
   Lesson view
   ============================================================ */

async function viewLesson(view, lessonId) {
  loading(view);
  const settings = getSettings();
  await renderLessonPlayer(view, lessonId, {});
}

/* ============================================================
   Review hub
   ============================================================ */

async function viewReview(view) {
  loading(view);
  docTitle('navReview');
  const L = currentLang;
  const [due, total, tags] = await Promise.all([dueItems(), reviewTotalCount(), availableTags()]);
  const states = await getAllLessonStates();

  const startSession = (items) => {
    viewReviewSession(view, items);
  };

  const head = el('div', { class: 'card' }, [
    el('h2', { text: `🔁 ${t(L, 'reviewTitle')}` }),
    el('p', { class: 'muted', text: t(L, 'reviewIntro') }),
    el('div', { class: 'row mt' }, [
      el('button', {
        class: 'btn btn-primary',
        text: `▶ ${t(L, 'startReview')} (${due.length})`,
        disabled: due.length === 0,
        onclick: () => startSession(due.slice(0, 15).map((d) => ({ exerciseId: d.exerciseId, lessonId: d.lessonId, tags: d.tags }))),
      }),
      el('span', { class: 'chip', text: `${total} ${t(L, 'reviewTitle')}` }),
    ]),
  ]);

  if (total === 0) {
    view.replaceChildren(head, el('div', { class: 'state-box' }, [
      el('div', { class: 'big', text: '🌱' }),
      el('h3', { text: t(L, 'reviewEmpty') }),
      el('a', { class: 'btn btn-primary mt', href: '#/', text: t(L, 'startLearning') }),
    ]));
    return;
  }

  // filters: by lesson + by tag (all tracked items, not only due ones)
  const reviewStore = await import('./review.js');
  const allItems = await reviewStore.dueItems(Number.MAX_SAFE_INTEGER);
  const lessonsSeen = new Map();
  for (const it of allItems) {
    if (!lessonsSeen.has(it.lessonId)) lessonsSeen.set(it.lessonId, 0);
    lessonsSeen.set(it.lessonId, lessonsSeen.get(it.lessonId) + 1);
  }

  const filters = el('div', { class: 'review-filters' });
  filters.append(el('span', { class: 'chip', text: `${t(L, 'filterByLesson')}:` }));
  for (const [lessonId, n] of lessonsSeen) {
    const manifestEntry = getManifest().find((m) => m.id === lessonId);
    filters.append(el('button', {
      class: 'filter-chip',
      text: `${manifestEntry ? manifestEntry.title : lessonId} (${n})`,
      onclick: () => startSession(allItems.filter((i) => i.lessonId === lessonId).slice(0, 15).map((d) => ({ exerciseId: d.exerciseId, lessonId: d.lessonId, tags: d.tags }))),
    }));
  }

  const tagRow = el('div', { class: 'review-filters' });
  if (tags.length) {
    tagRow.append(el('span', { class: 'chip', text: `${t(L, 'filterByTopic')}:` }));
    for (const tg of tags.slice(0, 24)) {
      tagRow.append(el('button', {
        class: 'filter-chip',
        text: tg,
        onclick: () => startSession(allItems.filter((i) => (i.tags || []).includes(tg)).slice(0, 15).map((d) => ({ exerciseId: d.exerciseId, lessonId: d.lessonId, tags: d.tags }))),
      }));
    }
  }

  view.replaceChildren(head, filters, tagRow);
}

function viewReviewSession(view, items) {
  // delegate to the lesson engine in review mode
  renderLessonPlayer(view, 'review-session', { reviewMode: { items } });
}

/* ============================================================
   Stats view
   ============================================================ */

async function viewStats(view) {
  loading(view);
  docTitle('navStats');
  const L = currentLang;
  const [overview, history, states] = await Promise.all([
    getOverview(), getDailyHistory(14), getAllLessonStates(),
  ]);

  const maxCount = Math.max(1, ...history.map((h) => h.count));
  const historyRow = el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '.35rem', minHeight: '90px' } });
  for (const h of history) {
    const barH = Math.max(4, Math.round((h.count / maxCount) * 70));
    historyRow.append(el('div', { style: { flex: '1', textAlign: 'center' }, title: `${h.day}: ${h.count}` }, [
      el('div', {
        style: { height: `${barH}px`, background: h.count ? 'var(--primary)' : 'var(--surface-2)', borderRadius: '5px 5px 2px 2px', marginInline: '2px' },
      }),
      el('div', { class: 'small muted', style: { fontSize: '.62rem' }, text: h.day.slice(8) }),
    ]));
  }

  const recent = Object.entries(states)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, 6);

  const recentBox = recent.length
    ? el('div', { class: 'lesson-list' }, recent.map(([id, st]) => {
        const m = getManifest().find((x) => x.id === id);
        if (!m) return null;
        return el('div', { class: 'lesson-item' }, [
          el('span', { class: 'lesson-num', text: st.completed ? '✓' : '…' }),
          el('div', { class: 'lesson-titles' }, [
            el('div', { class: 't', text: m.title }),
            el('div', { class: 's', text: `${m.titleAr} · ${st.bestAccuracy || 0}%` }),
          ]),
        ]);
      }).filter(Boolean))
    : el('p', { class: 'muted', text: t(L, 'noDataYet') });

  view.replaceChildren(
    el('h2', { text: `📊 ${t(L, 'statsTitle')}` }),
    el('div', { class: 'stat-grid mt mb' }, [
      statCard(formatNumber(overview.totalAnswers), t(L, 'totalAttempts')),
      statCard(formatNumber(overview.correctAnswers), t(L, 'correctAnswers')),
      statCard(`${overview.accuracy}%`, t(L, 'accuracy')),
      statCard(formatDuration(overview.studyTimeMs), t(L, 'timeTotal')),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: t(L, 'dailyHistory') }),
      historyRow,
      el('p', { class: 'small muted', text: `🔥 ${t(L, 'streakDays')}: ${overview.streak} · ★ ${overview.bestStreak}` }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: t(L, 'recentLessons') }),
      recentBox,
    ]),
  );
}

/* ============================================================
   Settings view
   ============================================================ */

async function viewSettings(view) {
  loading(view);
  docTitle('navSettings');
  const L = currentLang;
  const s = getSettings();

  const langSel = el('select', { 'aria-label': t(L, 'interfaceLanguage') }, [
    el('option', { value: 'en', text: t(L, 'langEn'), selected: s.lang === 'en' ? '' : null }),
    el('option', { value: 'ar', text: t(L, 'langAr'), selected: s.lang === 'ar' ? '' : null }),
  ]);
  langSel.addEventListener('change', () => {
    saveSettings({ lang: langSel.value });
    currentLang = langSel.value;
    applyDocumentSettings();
    renderShell();
    onChangeRerun();
  });

  const themeSel = el('select', { 'aria-label': t(L, 'theme') }, ['light', 'dark', 'system'].map((th) =>
    el('option', { value: th, text: t(L, `theme${th[0].toUpperCase()}${th.slice(1)}`), selected: s.theme === th ? '' : null })));
  themeSel.addEventListener('change', () => { saveSettings({ theme: themeSel.value }); applyDocumentSettings(); });

  const goalInput = el('input', { type: 'number', min: '5', max: '200', value: String(s.dailyGoal), style: { maxWidth: '110px' }, 'aria-label': t(L, 'dailyGoalSetting') });
  goalInput.addEventListener('change', () => { saveSettings({ dailyGoal: parseInt(goalInput.value, 10) || 20 }); toast(t(L, 'dataSaved')); });

  const arabicToggle = toggle(s.showArabic, (on) => saveSettings({ showArabic: on }));
  const strictToggle = toggle(s.strictGrading, (on) => saveSettings({ strictGrading: on }));

  const rateSel = el('select', { 'aria-label': t(L, 'speechRate') }, [
    el('option', { value: '0.65', text: '0.65×', selected: s.rate <= 0.65 ? '' : null }),
    el('option', { value: '0.8', text: '0.8×', selected: s.rate > 0.65 && s.rate <= 0.8 ? '' : null }),
    el('option', { value: '1', text: '1.0×', selected: s.rate > 0.8 && s.rate <= 1.05 ? '' : null }),
    el('option', { value: '1.15', text: '1.15×', selected: s.rate > 1.05 ? '' : null }),
  ]);
  rateSel.addEventListener('change', () => saveSettings({ rate: parseFloat(rateSel.value) }));

  // voice select — populated async
  const voiceSel = el('select', { 'aria-label': t(L, 'voice') });
  voiceSel.append(el('option', { value: '', text: t(L, 'voiceAuto') }));
  let voices = [];
  if (speechSupported()) {
    voices = await loadVoices();
    for (const v of englishVoices()) {
      voiceSel.append(el('option', { value: v.voiceURI, text: `${v.name} (${v.lang})`, selected: s.voiceURI === v.voiceURI ? '' : null }));
    }
  }
  voiceSel.addEventListener('change', () => saveSettings({ voiceURI: voiceSel.value }));
  const testVoiceBtn = el('button', { class: 'btn btn-sm', text: '🔊 Test', onclick: () => speak('Hello! This is LingoStep, your English practice partner.', { voiceURI: voiceSel.value, rate: parseFloat(rateSel.value) }) });

  const exportBtn = el('button', { class: 'btn', text: `⬇ ${t(L, 'exportProgress')}`, onclick: async () => {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `lingostep-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t(L, 'dataExported'));
  } });

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only' });
  const importBtn = el('button', { class: 'btn', text: `⬆ ${t(L, 'importProgress')}`, onclick: () => importInput.click() });
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (typeof confirm !== 'undefined' && !confirm(t(L, 'importWarn'))) return;
      await importBackup(data, { replace: true });
      toast(t(L, 'dataImported'));
      setTimeout(() => onChangeRerun(), 600);
    } catch (err) {
      toast(`${t(L, 'dataInvalid')}`);
      console.warn('import failed', err);
    }
    importInput.value = '';
  });

  const clearBtn = el('button', { class: 'btn btn-danger', text: `🗑 ${t(L, 'clearProgress')}`, onclick: async () => {
    if (typeof confirm !== 'undefined' && !confirm(t(L, 'clearConfirm'))) return;
    await clearAllProgress();
    toast(t(L, 'dataSaved'));
    setTimeout(() => onChangeRerun(), 500);
  } });

  // offline preparation
  const offlineBtn = el('button', { class: 'btn', text: `📦 ${t(L, 'prepareOffline')}`, onclick: async () => {
    offlineBtn.disabled = true;
    offlineBtn.textContent = `⏳ ${t(L, 'preparingOffline')}`;
    const manifest = getManifest();
    let ok = 0;
    for (const entry of manifest) {
      try {
        const url = new URL(entry.path, new URL('../', import.meta.url)).href;
        await fetch(url);
        ok += 1;
      } catch { /* offline already or failed */ }
    }
    offlineBtn.textContent = `✅ ${ok}/${manifest.length}`;
    toast(t(L, 'offlineReady'));
  } });

  view.replaceChildren(
    el('h2', { text: `⚙️ ${t(L, 'settingsTitle')}` }),
    el('div', { class: 'card mt' }, [
      settingRow(t(L, 'interfaceLanguage'), null, langSel),
      settingRow(t(L, 'theme'), null, themeSel),
      settingRow(t(L, 'dailyGoalSetting'), null, goalInput),
      settingRow(t(L, 'showArabic'), null, arabicToggle),
      settingRow(t(L, 'strictGrading'), null, strictToggle),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `🔊 ${t(L, 'speechSection')}` }),
      settingRow(t(L, 'voice'), null, voiceSel),
      settingRow(t(L, 'speechRate'), null, el('div', { class: 'row' }, [rateSel, testVoiceBtn])),
      el('p', { class: 'small muted', text: t(L, 'speechNote') }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `📦 ${t(L, 'offlineSection')}` }),
      el('div', { class: 'row' }, [offlineBtn]),
      el('p', { class: 'small muted', text: t(L, 'offlineNote') }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `💾 ${t(L, 'backupSection')}` }),
      el('div', { class: 'row' }, [exportBtn, importBtn, importInput]),
      el('p', { class: 'small muted', text: t(L, 'importWarn') }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: `⚠️ ${t(L, 'dangerZone')}` }),
      clearBtn,
    ]),
  );
}

function settingRow(label, desc, control) {
  return el('div', { class: 'setting-row' }, [
    el('div', {}, [
      el('label', { text: label }),
      desc ? el('div', { class: 'desc', text: desc }) : null,
    ].filter(Boolean)),
    control,
  ]);
}

function toggle(checked, onToggle) {
  const b = el('button', { class: 'toggle', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': 'toggle' });
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', next ? 'true' : 'false');
    onToggle(next);
  });
  return b;
}

/* ---------- boot ---------- */
if (typeof document !== 'undefined') {
  const ready = document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
  if (ready && typeof ready.catch === 'function') ready.catch((e) => console.error(e));
}
