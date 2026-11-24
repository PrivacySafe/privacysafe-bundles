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
// Settings of this app on this device. Pure code, shared by the window and the
// background service: the service stores the settings, and both sides need the
// same defaults and the same idea of what a valid stored value is.
import type { ContactsAppSettings, ContactsDateFormat } from '../../types/common-app.ts';

export const DATE_FORMATS: readonly ContactsDateFormat[] = ['MM.DD.YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD'];

export const APP_SETTINGS_DEFAULT: Readonly<ContactsAppSettings> = Object.freeze({
  dateFormat: 'MM.DD.YYYY',
});

export function isDateFormat(value: unknown): value is ContactsDateFormat {
  return typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value);
}

/**
 * Takes what was read from the settings file (or sent by a window) and keeps
 * only the known fields with valid values. Anything else falls back to the
 * default: a broken or older file must not break the app.
 */
export function sanitizeAppSettings(raw: unknown): ContactsAppSettings {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return {
    dateFormat: isDateFormat(value.dateFormat) ? value.dateFormat : APP_SETTINGS_DEFAULT.dateFormat,
  };
}

/**
 * Applies a patch to the current settings. Unknown fields and invalid values in
 * the patch are ignored.
 */
export function mergeAppSettings(
  current: ContactsAppSettings,
  patch: Partial<ContactsAppSettings>,
): ContactsAppSettings {
  const next: Record<string, unknown> = { ...current };
  if (patch && typeof patch === 'object' && isDateFormat(patch.dateFormat)) {
    next.dateFormat = patch.dateFormat;
  }

  return sanitizeAppSettings(next);
}
