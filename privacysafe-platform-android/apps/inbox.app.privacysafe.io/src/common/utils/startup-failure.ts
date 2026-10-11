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
 * Puts a plain message where the splash was.
 *
 * When the app cannot start, the splash keeps animating over a window that will
 * never load anything - which reads as "still working" and is the one thing the
 * user must not be told here. i18n is not available at this point: the failure
 * can happen before the Vue app exists at all.
 */
export function showStartupFailure(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  container.textContent = '';

  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;' +
    'justify-content:center;align-items:center;row-gap:8px;padding:24px;' +
    'text-align:center;font-family:Inter,system-ui,sans-serif;' +
    'color:var(--color-text-control-primary-default,#e0e0e0);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:16px;font-weight:600;';
  title.textContent = 'Inbox could not start';

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:13px;opacity:0.7;';
  hint.textContent = 'Its background services are not reachable. Please close the app and open it again.';

  box.appendChild(title);
  box.appendChild(hint);
  container.appendChild(box);
}
