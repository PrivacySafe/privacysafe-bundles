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
// Texts of the reminder notifications, in the language the user has chosen in
// the launcher. The texts are those of the window (src/common/data/i18), so a
// translation is made in one place.
import { en } from '../../src/common/data/i18/en.ts';
import { es } from '../../src/common/data/i18/es.ts';
import { fr } from '../../src/common/data/i18/fr.ts';
import type { DateReminder } from './date-reminders.ts';

type ReminderTexts = typeof en.reminders;

const TEXTS: Record<string, ReminderTexts> = {
  en: en.reminders,
  es: es.reminders,
  fr: fr.reminders,
};

/** The command a click on the notification starts the window with. */
export const OPEN_CONTACT_CMD = 'open-contact';

export interface OpenContactCmdArg {
  contactId: string;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/{(\w+)}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function reminderNotificationTexts(reminder: DateReminder, lang: string): { title: string; body: string } {
  const texts = (TEXTS[lang] ?? TEXTS.en).birthday;
  const values = { name: reminder.displayName, age: reminder.age ?? '' };

  return {
    title: fill(texts.title, values),
    body: fill(reminder.age ? texts.bodyWithAge : texts.body, values),
  };
}

export function reminderNotificationOpts(
  reminder: DateReminder,
  lang: string,
  icon?: Uint8Array,
): web3n.shell.notifications.NotificationOpts {
  return {
    ...reminderNotificationTexts(reminder, lang),
    ...(icon ? { icon } : {}),
    cmd: {
      cmd: OPEN_CONTACT_CMD,
      params: [{ contactId: reminder.contactId } as OpenContactCmdArg],
    },
  };
}

/**
 * The language set in the launcher, or 'en' when it cannot be read. Read on
 * every reminder rather than once: the user may change it while the service
 * runs, and reminders are rare.
 */
export async function readUiLanguage(): Promise<string> {
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
