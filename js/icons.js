import { ICONS } from './icon-config.js';

export function icon(name, className = 'ui-icon') {
  const span = document.createElement('span');
  span.className = className.includes('ui-icon') ? className : `ui-icon ${className}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[name] || ICONS.circle}</svg>`;
  return span;
}

export function iconLabel(name, label, className = 'icon-label') {
  const wrap = document.createElement('span');
  wrap.className = className;
  wrap.append(icon(name), document.createTextNode(String(label ?? '')));
  return wrap;
}
