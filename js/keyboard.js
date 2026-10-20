/* ============================================================
   LingoStep — keyboard.js
   On-screen Latin keyboard for dictation & fill-blank answers.

   Spec requirements implemented here:
   - Letter keys A–Z (QWERTY layout, with Shift for capitals),
     Space, Backspace, Clear, Enter.
   - Connected to the REAL input element: edits go through
     input.value at the current caret position (selectionStart),
     then an `input` event is dispatched so the rest of the app
     sees a normal edit.
   - Native keyboard stays fully usable — the on-screen keyboard
     is an additional input method, not a replacement.
   - Buttons never steal focus from the input (pointerdown is
     prevented), so the caret stays visible.
   - Optional: the user can turn it off in Settings
     (settings.onScreenKeyboard, default on).
   - Fresh DOM per call → no duplicated event listeners between
     exercises.
   ============================================================ */

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/**
 * Build an on-screen keyboard bound to `input`.
 * opts: { onEnter: () => void, labels: { backspace, clear, enter, shift } }
 * Returns { root, destroy } — call destroy() when re-rendering.
 */
export function createOnScreenKeyboard(input, opts = {}) {
  if (!input || typeof input !== 'object' || !input.tagName) {
    return { root: document.createDocumentFragment(), destroy() {} };
  }
  const labels = opts.labels || {};
  const state = { shift: false };
  const root = document.createElement('div');
  root.className = 'osk';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', labels.aria || 'On-screen keyboard');

  function applyEdit(nextValue, caretPos) {
    input.value = nextValue;
    try { input.setSelectionRange(caretPos, caretPos); } catch { /* input types without caret */ }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insert(text) {
    const ch = state.shift ? text.toUpperCase() : text;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const v = input.value;
    const next = v.slice(0, start) + ch + v.slice(end);
    const wasShift = state.shift;
    if (wasShift) toggleShift(false); // auto-release after one capital
    applyEdit(next, start + ch.length);
  }

  function backspace() {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const v = input.value;
    let next, caret;
    if (start === end && start > 0) {
      next = v.slice(0, start - 1) + v.slice(end);
      caret = start - 1;
    } else if (start !== end) {
      next = v.slice(0, start) + v.slice(end);
      caret = start;
    } else {
      return; // nothing to delete
    }
    applyEdit(next, caret);
  }

  function clearAll() {
    applyEdit('', 0);
  }

  function toggleShift(force) {
    state.shift = typeof force === 'boolean' ? force : !state.shift;
    refreshCase();
  }

  function refreshCase() {
    root.querySelectorAll('.osk-key[data-key]').forEach((b) => {
      const base = b.getAttribute('data-key');
      b.textContent = state.shift ? base.toUpperCase() : base;
      b.setAttribute('aria-label', state.shift ? base.toUpperCase() : base);
    });
    const shiftBtn = root.querySelector('[data-action="shift"]');
    if (shiftBtn) shiftBtn.classList.toggle('osk-active', state.shift);
  }

  function key(text, { className = '', action = null, label = null } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `osk-key ${className}`.trim();
    if (action) b.setAttribute('data-action', action);
    else b.setAttribute('data-key', text);
    b.setAttribute('aria-label', label || text);
    b.textContent = text;
    // Prevent focus stealing: edit the input without moving focus.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (action === 'shift') return toggleShift();
      if (action === 'space') return insert(' ');
      if (action === 'backspace') return backspace();
      if (action === 'clear') return clearAll();
      if (action === 'enter') { if (typeof opts.onEnter === 'function') opts.onEnter(); return; }
      insert(text);
    });
    return b;
  }

  for (const row of ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'osk-row';
    for (const ch of row) rowEl.append(key(ch));
    root.append(rowEl);
  }
  const bottom = document.createElement('div');
  bottom.className = 'osk-row osk-bottom';
  bottom.append(
    key('⇧', { action: 'shift', className: 'osk-wide', label: labels.shift || 'Shift' }),
    key('␣', { action: 'space', className: 'osk-space', label: labels.space || 'Space' }),
    key('⌫', { action: 'backspace', className: 'osk-wide', label: labels.backspace || 'Backspace' }),
    key('✕', { action: 'clear', className: 'osk-wide', label: labels.clear || 'Clear' }),
    key('⏎', { action: 'enter', className: 'osk-enter', label: labels.enter || 'Enter' }),
  );
  root.append(bottom);

  return { root, destroy() { root.remove(); } };
}

/**
 * Append an on-screen keyboard under `input` (inside `mountAfter`)
 * when the setting is on. Returns { destroy }.
 */
export function attachKeyboard(input, mountAfter, enabled, labels) {
  if (!enabled) return { destroy() {} };
  const kb = createOnScreenKeyboard(input, { onEnter: () => {
    // Mirror the physical Enter behavior set by the lesson engine.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, labels });
  if (mountAfter && typeof mountAfter.appendChild === 'function') mountAfter.appendChild(kb.root);
  else if (input.parentElement) input.parentElement.insertAdjacentElement('afterend', kb.root);
  return { destroy: kb.destroy };
}
