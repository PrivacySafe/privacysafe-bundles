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
// A line of text under the start-up animation of index.html, for the time the
// window waits for the service of this app. Vue is not mounted yet then - it is
// mounted only once the service is connected or given up on - so the line is
// put into the static markup directly, and vue-i18n is not at hand either: the
// language is read the way the app reads it later, from the launcher.
import { en } from '@main/common/data/i18/en';
import { es } from '@main/common/data/i18/es';
import { fr } from '@main/common/data/i18/fr';

type StartupTexts = typeof en.app.startup;

const TEXTS: Record<string, StartupTexts> = {
  en: en.app.startup,
  es: es.app.startup,
  fr: fr.app.startup,
};

export const STARTUP_STATUS_CLASS = 'app-init-status';

let langPromise: Promise<string> | undefined;

async function readUiLanguage(): Promise<string> {
  try {
    const file = (await w3n.shell!.getFSResource!(
      'launcher.app.privacysafe.io',
      'ui-settings',
    )) as web3n.files.ReadonlyFile;
    const { lang } = await file.readJSON<{ lang?: string }>();
    return (typeof lang === 'string' && lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

export async function startupTexts(): Promise<StartupTexts> {
  langPromise ??= readUiLanguage();
  return TEXTS[await langPromise] ?? TEXTS.en;
}

export function fillStartupText(template: string, values: Record<string, string | number>): string {
  return template.replace(/{(\w+)}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/**
 * Shows the text under the start-up animation. Does nothing when the animation
 * is gone, i.e. the app is already mounted over it.
 */
export function setStartupStatus(text: string): void {
  const container = document.querySelector('.app-init');
  if (!container) {
    return;
  }

  let line = container.querySelector<HTMLElement>(`.${STARTUP_STATUS_CLASS}`);
  if (!line) {
    line = document.createElement('div');
    line.className = STARTUP_STATUS_CLASS;
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    container.appendChild(line);
  }
  line.textContent = text;
}

/** Tells that the service is not reachable yet and which attempt comes next. */
export async function showServiceWaitStatus(nextAttempt: number, attempts: number): Promise<void> {
  const texts = await startupTexts();
  setStartupStatus(fillStartupText(texts.waitingForService, { attempt: nextAttempt, total: attempts }));
}
