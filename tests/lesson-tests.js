/* ============================================================
   lesson-tests.js — imports every lesson module (Node) and
   asserts manifest validity, schema compliance, counts and
   section minimums. Mirrors scripts/validate-lessons.js.
   ============================================================ */

import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { lessonManifest } from '../data/lesson-manifest.js';
import { validateLessonStructure, normalizeForDup, SECTIONS } from '../js/lesson-schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = {
  basics: [12, 600], tenses: [24, 1200], grammar: [16, 800],
  conversations: [20, 1000], 'practical-scenarios': [16, 800],
  vocabulary: [16, 800], 'listening-writing': [16, 800],
};

export async function run() {
  const name = 'lesson-tests';

  assert.ok(lessonManifest.length >= 120, `manifest lessons ${lessonManifest.length} >= 120`);
  assert.deepEqual(new Set(lessonManifest.map((l) => l.section)), new Set(SECTIONS), 'all seven sections present');

  const ids = new Set();
  const exIds = new Set();
  const globalSeen = new Map();
  const sectionCarriers = {};
  for (const s of SECTIONS) sectionCarriers[s] = 0;

  for (const entry of lessonManifest) {
    assert.ok(!ids.has(entry.id), `unique lesson id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.available !== false, `${entry.id} available`);
    assert.ok(typeof entry.path === 'string' && entry.path.startsWith('lessons/'), `${entry.id} path shape`);

    const mod = await import(new URL(`file://${join(ROOT, entry.path)}`));
    const lesson = mod.default;
    const errs = validateLessonStructure(lesson, entry.id);
    assert.deepEqual(errs, [], `${entry.id} schema: ${errs.slice(0, 3).join('|')}`);
    assert.equal(lesson.section, entry.section, `${entry.id} section match`);
    assert.equal(lesson.exercises.length, entry.exercises, `${entry.id} exercise count matches manifest`);

    const localAny = new Set();
    for (const ex of lesson.exercises) {
      assert.ok(!exIds.has(ex.id), `unique exercise id ${ex.id}`);
      exIds.add(ex.id);
      if (['listen-and-type', 'fill-blank', 'word-order'].includes(ex.type)) {
        const key = normalizeForDup(ex.en);
        sectionCarriers[entry.section] += 1;
        const owner = globalSeen.get(key);
        if (owner === undefined) globalSeen.set(key, entry.id);
        else if (owner !== entry.id && !localAny.has(key)) {
          assert.fail(`cross-lesson duplicate sentence [${owner}→${entry.id}]: ${ex.en}`);
        }
        localAny.add(key);
      }
    }
  }

  for (const [section, [minLessons, minSentences]] of Object.entries(MIN)) {
    assert.ok(lessonManifest.filter((l) => l.section === section).length >= minLessons, `${section} lesson minimum`);
    assert.ok(sectionCarriers[section] >= minSentences, `${section} sentence minimum (${sectionCarriers[section]})`);
  }

  assert.ok(globalSeen.size >= 6000, `unique practice sentences ${globalSeen.size} >= 6000`);
  assert.ok(lessonManifest.length >= 120, 'at least 120 lessons');

  return { name, pass: true, info: `${lessonManifest.length} lessons, ${globalSeen.size} unique sentences` };
}
