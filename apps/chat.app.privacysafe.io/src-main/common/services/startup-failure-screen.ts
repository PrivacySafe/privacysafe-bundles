/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * What the splash screen says while the app cannot start.
 *
 * Plain DOM, no Vue, on purpose: the app is mounted only after its services
 * answer, so the one case that needs explaining - they never do - is the one
 * case where no component can be rendered. Until this existed, that case was
 * an animated splash that spun forever with nothing written anywhere the user
 * could see (2026-09-10).
 *
 * Written into the splash's own stage element, so it reads as the same screen
 * rather than as a different one.
 */

import i18n from '@main/common/data/i18';

const MESSAGE_CLASS = 'app-init-message';

function stageElement(rootId: string): HTMLElement | null {
  const root = document.getElementById(rootId);
  return (root?.querySelector('.app-init-stage') as HTMLElement | null)
    ?? (root?.querySelector('.app-init-stage--mobile') as HTMLElement | null)
    ?? root;
}

function messageElement(rootId: string): HTMLElement | undefined {
  const stage = stageElement(rootId);
  if (!stage) {
    return undefined;
  }
  let el = stage.querySelector(`.${MESSAGE_CLASS}`) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = MESSAGE_CLASS;
    stage.appendChild(el);
  }
  return el;
}

function t(key: string, named?: Record<string, unknown>): string {
  // i18n is created on import and its global `t` works with no app mounted,
  // which is the whole reason these strings can be translated at all here.
  return named ? i18n.global.t(key, named) : i18n.global.t(key);
}

/**
 * One line under the splash saying what is being waited for. Replaces whatever
 * the overlay showed before.
 */
export function showStartupProgress(rootId: string, text: string): void {
  const el = messageElement(rootId);
  if (!el) {
    return;
  }
  el.innerHTML = '';
  const details = document.createElement('div');
  details.className = `${MESSAGE_CLASS}__details`;
  details.textContent = text;
  el.appendChild(details);
}

/**
 * The dead end: what happened, and the two things that are worth doing about
 * it. Retry reloads the window - the service callers are bound to their
 * connection for good and cannot reconnect - and the other button closes this
 * window, which is all a component can do for itself: a background component
 * that has stopped answering outlives every window of its app, and only a full
 * restart of the platform app brings it back.
 */
export function showStartupFailure(
  rootId: string,
  o: { title: string; details: string; onRetry: () => void; onClose: () => void },
): void {
  const el = messageElement(rootId);
  if (!el) {
    return;
  }
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = `${MESSAGE_CLASS}__title`;
  title.textContent = o.title;
  el.appendChild(title);

  const details = document.createElement('div');
  details.className = `${MESSAGE_CLASS}__details`;
  details.textContent = o.details;
  el.appendChild(details);

  const actions = document.createElement('div');
  actions.className = `${MESSAGE_CLASS}__actions`;

  const retry = document.createElement('button');
  retry.className = 'app-init-btn';
  retry.textContent = t('app.startup.retry');
  retry.addEventListener('click', o.onRetry);
  actions.appendChild(retry);

  const close = document.createElement('button');
  close.className = 'app-init-btn app-init-btn--secondary';
  close.textContent = t('app.startup.closeWindow');
  close.addEventListener('click', o.onClose);
  actions.appendChild(close);

  el.appendChild(actions);
}

export function clearStartupOverlay(rootId: string): void {
  const stage = stageElement(rootId);
  stage?.querySelector(`.${MESSAGE_CLASS}`)?.remove();
}
