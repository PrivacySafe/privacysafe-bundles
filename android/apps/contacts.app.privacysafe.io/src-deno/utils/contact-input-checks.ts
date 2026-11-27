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
 * The shape a contact may be stored in, whoever hands it over: this app's
 * window, Chat or Inbox through the AppContacts service, an import.
 *
 * Nothing checked contacts before the audit of 2026-11-26: a number as a name
 * broke the contact list on every device the db synced to, any string with an
 * '@' was an address, and an update without `settings` silently unblocked the
 * contact.
 */

import { checkAndTransformAddress } from '../../shared-libs/address-utils.ts';
import type { Person, RawPerson } from '../../src/types/index.ts';

export const MAX_CONTACT_NAME_LENGTH = 200;
export const MAX_CONTACT_NOTICE_LENGTH = 10_000;
export const MAX_CONTACT_PHONE_LENGTH = 64;
const MAX_ACTIVITIES = 1000;
const MAX_SETTINGS_JSON_LENGTH = 10_000;

/** Ids of image files, as addImage makes them: no path in them. */
const imageId = /^[A-Za-z0-9_-]{1,100}$/;

export function isImageId(id: string): boolean {
  return imageId.test(id);
}

/**
 * An avatar as the app keeps it: a data URL of a raster image. A restored
 * backup used to write whatever text its images folder held, and the GUI puts
 * avatars into CSS url().
 */
export function isAvatarDataURL(value: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]*$/.test(value);
}

// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

type AnyContact = RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>;

export class InvalidContactError extends Error {}

/** Text cut to a length, and for a one-line field without line breaks. */
export function boundedText(text: string, max: number, oneLine: boolean): string {
  const t = oneLine ? text.replace(controlChars, ' ').trim() : text;
  return (t.length > max) ? t.substring(0, max) : t;
}

function optionalText(value: unknown, max: number, field: string, oneLine: boolean): string | undefined {
  if ((value === undefined) || (value === null) || (value === '')) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new InvalidContactError(`Contact ${field} is not a string`);
  }
  const text = oneLine ? value.replace(controlChars, ' ').trim() : value;
  return (text.length > max) ? text.substring(0, max) : text;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && (typeof v === 'object') && !Array.isArray(v);
}

/**
 * A contact in the shape it may be stored in, or an InvalidContactError.
 *
 * Text fields are strings of bounded length, the name one line; the mail is an
 * address; an avatar id names an image file and nothing else; settings and
 * activities are of their shapes. The given object is not changed.
 */
export function checkedContact<T extends AnyContact>(contact: T): T {
  if (!isPlainObject(contact)) {
    throw new InvalidContactError('Contact is not an object');
  }
  const c = contact as Record<string, unknown>;
  if ((typeof c.mail !== 'string') || !checkAndTransformAddress(c.mail)) {
    throw new InvalidContactError('Contact mail is not an address');
  }
  if ((c.id !== undefined) && ((typeof c.id !== 'string') || !c.id)) {
    throw new InvalidContactError('Contact id is not a string');
  }
  if ((c.avatarId !== undefined) && (c.avatarId !== null) && (c.avatarId !== '')
    && ((typeof c.avatarId !== 'string') || !imageId.test(c.avatarId))) {
    throw new InvalidContactError('Contact avatar id is not an image id');
  }
  const settings = c.settings;
  if ((settings !== undefined) && (settings !== null)) {
    const parsed = (typeof settings === 'string') ? safeParse(settings) : settings;
    if (!isPlainObject(parsed) || (JSON.stringify(parsed).length > MAX_SETTINGS_JSON_LENGTH)
      || ((parsed.blockUser !== undefined) && (typeof parsed.blockUser !== 'boolean'))) {
      throw new InvalidContactError('Contact settings are malformed');
    }
  }
  const activities = c.activities;
  if ((activities !== undefined) && (activities !== null)) {
    const parsed = (typeof activities === 'string') ? safeParse(activities) : activities;
    if (!Array.isArray(parsed) || (parsed.length > MAX_ACTIVITIES)
      || parsed.some(a => typeof a !== 'string')) {
      throw new InvalidContactError('Contact activities are malformed');
    }
  }
  return {
    ...contact,
    name: optionalText(c.name, MAX_CONTACT_NAME_LENGTH, 'name', true),
    notice: optionalText(c.notice, MAX_CONTACT_NOTICE_LENGTH, 'notice', false),
    phone: optionalText(c.phone, MAX_CONTACT_PHONE_LENGTH, 'phone', true),
  };
}

/**
 * An update that leaves out `settings` or `activities` keeps the stored ones.
 * They used to be written as NULL - which for `settings` meant "not blocked":
 * a caller sending a contact back without its settings unblocked it.
 */
export function withKeptAspects<T extends AnyContact>(update: T, stored: AnyContact | undefined): T {
  if (!stored) {
    return update;
  }
  const u = update as Record<string, unknown>;
  const s = stored as Record<string, unknown>;
  return {
    ...update,
    ...((u.settings === undefined) && (s.settings !== undefined) && { settings: s.settings }),
    ...((u.activities === undefined) && (s.activities !== undefined) && { activities: s.activities }),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
