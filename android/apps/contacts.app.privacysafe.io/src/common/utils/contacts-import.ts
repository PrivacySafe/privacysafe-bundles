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

/** Fields of a contact the user decides on. The mail is the same in both. */
export const IMPORT_FIELDS = ['avatar', 'name', 'phone', 'notice'] as const;

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

function valueOf(contact: Person | ImportedContact, field: ImportField): string {
  if (field === 'avatar') {
    return contact.avatarImage || '';
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

  const pick = (field: Exclude<ImportField, 'avatar'>): string => (
    (sourceOf(field) === 'incoming') ? (incoming[field] || '') : (existing[field] || '')
  );

  const avatarSource = sourceOf('avatar');
  const contact: ContactToSave = {
    id: existing.id,
    mail: existing.mail,
    name: pick('name'),
    phone: pick('phone'),
    notice: pick('notice'),
    avatarId: (avatarSource === 'current') ? existing.avatarId : undefined,
    settings: existing.settings,
    activities: existing.activities,
  };

  const isUnchanged = (avatarSource === 'current' || (!existing.avatarImage && !incoming.avatarImage))
    && (contact.name === (existing.name || ''))
    && (contact.phone === (existing.phone || ''))
    && (contact.notice === (existing.notice || ''));

  return isUnchanged ? undefined : { contact, avatarSource };
}
