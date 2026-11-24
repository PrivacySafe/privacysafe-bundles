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
// Decisions on contacts imported from a file shared by another user, when
// the user already has a contact with the same address.
import type { ImportedContact, Person } from '@main/types';
import { getBirthday, withBirthday } from './contact-dates';

/** Fields of a contact the user decides on. The mail is the same in both. */
export const IMPORT_FIELDS = ['avatar', 'name', 'phone', 'notice', 'birthday'] as const;

export type ImportField = typeof IMPORT_FIELDS[number];

export type ImportFieldSource = 'current' | 'incoming';

export type ImportDecision =
  | { kind: 'keep' }
  | { kind: 'incoming' }
  | { kind: 'fields'; fields: Record<ImportField, ImportFieldSource> };

/** A contact as it is saved, see the store's upsertContact. */
export type ContactToSave = Omit<Person, 'timestamp' | 'avatarImage'>;

export interface MergeResult {
  contact: ContactToSave;
  /**
   * Where the avatar comes from. 'incoming' with an image means that it has
   * to be stored first, and its id put into the contact; with no image it
   * means that the contact loses its avatar.
   */
  avatarSource: ImportFieldSource;
}

/**
 * The birthday as a comparable text: `YYYY-MM-DD`, or `--MM-DD` without a
 * year (the notation of ISO 8601 for a day of no particular year). Whether to
 * be reminded of it is not part of it: that is never imported.
 */
function birthdayKey(contact: Person | ImportedContact): string {
  const birthday = getBirthday(contact.dates);
  if (!birthday) {
    return '';
  }

  const mm = String(birthday.month).padStart(2, '0');
  const dd = String(birthday.day).padStart(2, '0');
  return (birthday.year === undefined) ? `--${mm}-${dd}` : `${String(birthday.year).padStart(4, '0')}-${mm}-${dd}`;
}

function valueOf(contact: Person | ImportedContact, field: ImportField): string {
  if (field === 'avatar') {
    return contact.avatarImage || '';
  }
  if (field === 'birthday') {
    return birthdayKey(contact);
  }
  return contact[field] || '';
}

/** Fields whose values differ, i.e. the ones there is anything to choose in. */
export function differingFields(existing: Person, incoming: ImportedContact): ImportField[] {
  return IMPORT_FIELDS.filter(f => valueOf(existing, f) !== valueOf(incoming, f));
}

/**
 * The contact to save after the user's decision, or undefined when there is
 * nothing to change. Taking the incoming contact is literal: an empty incoming
 * field clears the current value. Settings (blocking) and activities are this
 * user's own business, and always stay as they are.
 */
export function mergeContact(
  existing: Person,
  incoming: ImportedContact,
  decision: ImportDecision,
): MergeResult | undefined {
  if (decision.kind === 'keep') {
    return undefined;
  }

  const sourceOf = (field: ImportField): ImportFieldSource => (
    (decision.kind === 'incoming') ? 'incoming' : decision.fields[field]
  );

  const pick = (field: Exclude<ImportField, 'avatar' | 'birthday'>): string => (
    (sourceOf(field) === 'incoming') ? (incoming[field] || '') : (existing[field] || '')
  );

  const avatarSource = sourceOf('avatar');
  const birthdaySource = sourceOf('birthday');
  const contact: ContactToSave = {
    id: existing.id,
    mail: existing.mail,
    name: pick('name'),
    phone: pick('phone'),
    notice: pick('notice'),
    avatarId: (avatarSource === 'current') ? existing.avatarId : undefined,
    dates: (birthdaySource === 'incoming') ? takeIncomingBirthday(existing, incoming) : (existing.dates ?? []),
    settings: existing.settings,
    activities: existing.activities,
  };

  const isUnchanged = (avatarSource === 'current' || (!existing.avatarImage && !incoming.avatarImage))
    && (valueOf(contact as Person, 'birthday') === valueOf(existing, 'birthday'))
    && (contact.name === (existing.name || ''))
    && (contact.phone === (existing.phone || ''))
    && (contact.notice === (existing.notice || ''));

  return isUnchanged ? undefined : { contact, avatarSource };
}

/**
 * The existing dates with the incoming birthday in place of the current one.
 * The reminder stays as the user had set it: it is their choice, and the
 * incoming contact never carries one.
 */
function takeIncomingBirthday(existing: Person, incoming: ImportedContact) {
  const current = getBirthday(existing.dates);
  const next = getBirthday(incoming.dates);
  if (!next) {
    return withBirthday(existing.dates, undefined);
  }

  const birthday = { ...next, id: current?.id ?? next.id };
  delete birthday.notify;
  if (current?.notify) {
    birthday.notify = true;
  }
  return withBirthday(existing.dates, birthday);
}
