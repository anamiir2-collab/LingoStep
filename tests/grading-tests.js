/* ============================================================
   grading-tests.js — answer checking and normalization.
   Run via: node tests/run-all.js  (or directly)
   ============================================================ */

import assert from 'node:assert/strict';
import { checkAnswer, normalizeCore, normalizeLenient, expandContractions, isAcceptable, similarity, firstDiffWord } from '../js/grading.js';

export function run() {
  const name = 'grading-tests';

  // normalization
  assert.equal(normalizeCore('  Hello   World '), 'hello world');
  assert.equal(normalizeCore('I\u2019m fine'), "i'm fine");
  assert.equal(normalizeLenient('I go home.'), 'i go home');
  assert.equal(normalizeLenient('Really?!'), 'really');
  assert.equal(expandContractions("don't be late"), 'do not be late');
  assert.equal(expandContractions("I'm sure she'll come"), 'i am sure she will come');

  // statuses
  assert.equal(checkAnswer('', ['I go home.']).status, 'empty');
  assert.equal(checkAnswer('   ', ['I go home.']).status, 'empty');
  assert.equal(checkAnswer('i  go home ', ['I go home.']).status, 'minor', 'case+spaces fine; missing final period → minor');
  assert.equal(checkAnswer('i  go home. ', ['I go home.']).status, 'correct', 'same words + period → correct');
  assert.equal(checkAnswer('I go home', ['I go home.']).status, 'minor', 'missing trailing period → minor');
  assert.equal(checkAnswer('I go home.', ['I go home.', 'I go to home.']).status, 'correct');
  assert.equal(checkAnswer('She goes to school', ['She goes to school.']).status, 'minor');
  assert.equal(checkAnswer('He dont like tea.', ["He doesn't like tea."]).status, 'incorrect', 'contraction respected');
  assert.equal(checkAnswer("He doesn't like tea.", ["He doesn't like tea."]).status, 'correct');
  assert.equal(checkAnswer('He does not like tea.', ["He doesn't like tea."]).status, 'incorrect', 'strict: do not ≠ doesn’t');
  assert.equal(checkAnswer('He does not like tea.', ["He doesn't like tea."], { strict: false }).status, 'minor', 'lenient: contraction expansion → minor');

  // accepted answers
  const r = checkAnswer('color', ['colour', 'color']);
  assert.equal(r.status, 'correct');
  assert.equal(r.matchedAnswer, 'color');

  // empty / garbage
  assert.equal(checkAnswer('???', ['I go home.']).status, 'incorrect');
  assert.equal(isAcceptable('i GO  home ', ['I go home.']), true);
  assert.equal(isAcceptable('I went home.', ['I go home.']), false);

  // meaningful grammar differences are never forgiven
  assert.equal(checkAnswer('She go to school.', ['She goes to school.']).status, 'incorrect');
  assert.equal(checkAnswer('They is happy.', ['They are happy.']).status, 'incorrect');
  assert.equal(checkAnswer('I have saw it.', ['I have seen it.']).status, 'incorrect');

  // diff info
  const d = checkAnswer('I drink teea every morning.', ['I drink tea every morning.']);
  assert.equal(d.diff.word, 3);
  assert.equal(d.diff.typed, 'teea');
  assert.equal(d.diff.expected, 'tea');
  assert.ok(firstDiffWord('a b c', 'a b d').word === 3);

  // similarity helper
  assert.ok(similarity('I like tea', 'I like tea') === 1);
  assert.ok(similarity('I like tea', 'You hate coffee') < 0.5);

  return { name, pass: true };
}
