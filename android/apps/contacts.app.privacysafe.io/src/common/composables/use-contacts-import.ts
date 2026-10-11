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
import { computed, ref, shallowRef } from 'vue';
import { storeToRefs } from 'pinia';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants';
import { isSameMailAddress } from '@main/common/utils/mail-address';
import { blobFromDataURL } from '@main/common/utils/image-files';
import { saveContactAvatar } from '@main/common/utils/contact-avatar';
import {
  differingFields,
  mergeContact,
  type ImportDecision,
  type ImportField,
} from '@main/common/utils/contacts-import';
import type { ImportedContact, Person } from '@main/types';

export interface ImportConflict {
  existing: Person;
  incoming: ImportedContact;
  /** Fields with different values; the others need no choice. */
  fields: ImportField[];
}

export interface ImportStats {
  added: number;
  updated: number;
  skipped: number;
}

export type ImportOutcome = 'done' | 'aborted' | 'not-found';

async function storeAvatar(dataURL: string | undefined): Promise<string | undefined> {
  if (!dataURL) {
    return undefined;
  }
  try {
    const { avatarId } = await saveContactAvatar(blobFromDataURL(dataURL));
    return avatarId;
  } catch (err) {
    // A contact without its picture is still worth importing.
    await w3n.log('warning', 'Fail to store an avatar of an imported contact', err);
    return undefined;
  }
}

/**
 * Import of contacts from a file shared by another user. The service has
 * already read the file; here each contact is either added, or, when the user
 * has one with the same address, put before the user to decide on.
 */
export function useContactsImport(importId: string) {
  const { user } = storeToRefs(useAppStore());
  const contactsStore = useContactsStore();
  const { findContactByMail, upsertContact } = contactsStore;

  const total = ref(0);
  const processed = ref(0);
  const stats = ref<ImportStats>({ added: 0, updated: 0, skipped: 0 });
  const conflict = shallowRef<ImportConflict | null>(null);
  /** Decision taken for all remaining conflicts, see decide(). */
  const decisionForAll = ref<'keep' | 'incoming' | null>(null);
  const isRunning = ref(false);

  let isAborted = false;
  let resolveDecision: ((decision: ImportDecision) => void) | undefined = undefined;

  const percent = computed(() => (total.value ? Math.round((processed.value / total.value) * 100) : 0));

  function waitForDecision(value: ImportConflict): Promise<ImportDecision> {
    conflict.value = value;
    return new Promise<ImportDecision>(resolve => {
      resolveDecision = resolve;
    });
  }

  /**
   * The user's decision on the shown conflict. With `forAll`, keeping or
   * taking the incoming contact is applied to the remaining conflicts too.
   */
  function decide(decision: ImportDecision, forAll = false): void {
    if (forAll && (decision.kind !== 'fields')) {
      decisionForAll.value = decision.kind;
    }
    const resolve = resolveDecision;
    resolveDecision = undefined;
    conflict.value = null;
    resolve?.(decision);
  }

  /** Stops the import after the contact being processed; added ones stay. */
  function abort(): void {
    isAborted = true;
    decide({ kind: 'keep' });
  }

  async function addContact(incoming: ImportedContact): Promise<void> {
    const avatarId = await storeAvatar(incoming.avatarImage);
    const res = await upsertContact({
      id: NEW_EMPTY_CONTACT_ID,
      mail: incoming.mail,
      name: incoming.name || '',
      phone: incoming.phone || '',
      notice: incoming.notice || '',
      avatarId,
    });

    if ('errorType' in res) {
      await w3n.log('warning', `Imported contact ${incoming.mail} is not added: ${res.errorMessage}`);
      stats.value.skipped += 1;
    } else {
      stats.value.added += 1;
    }
  }

  async function updateContact(existing: Person, incoming: ImportedContact): Promise<void> {
    const fields = differingFields(existing, incoming);
    if (fields.length === 0) {
      stats.value.skipped += 1;
      return;
    }

    const decision: ImportDecision = decisionForAll.value
      ? { kind: decisionForAll.value }
      : await waitForDecision({ existing, incoming, fields });
    if (isAborted) {
      return;
    }

    const merged = mergeContact(existing, incoming, decision);
    if (!merged) {
      stats.value.skipped += 1;
      return;
    }

    const { contact, avatarSource } = merged;
    const takesNewAvatar = (avatarSource === 'incoming') && (existing.avatarImage !== incoming.avatarImage);
    if (takesNewAvatar) {
      contact.avatarId = await storeAvatar(incoming.avatarImage);
    }

    const res = await upsertContact(contact);
    if ('errorType' in res) {
      await w3n.log('warning', `Contact ${existing.mail} is not updated by import: ${res.errorMessage}`);
      stats.value.skipped += 1;
      return;
    }

    // Removed only once the contact no longer points at it.
    if (takesNewAvatar && existing.avatarId && (existing.avatarId !== contact.avatarId)) {
      await appContactsSrvProxy.deleteImage(existing.avatarId).catch(err =>
        w3n.log('warning', `Fail to remove a replaced avatar ${existing.avatarId}`, err),
      );
    }
    stats.value.updated += 1;
  }

  async function processContact(incoming: ImportedContact): Promise<void> {
    // The user's own record is not someone else's to describe.
    if (isSameMailAddress(incoming.mail, user.value)) {
      stats.value.skipped += 1;
      return;
    }

    const listed = findContactByMail(incoming.mail);
    const existing = listed ? await appContactsSrvProxy.getContact(listed.id) : undefined;
    if (existing) {
      await updateContact(existing, incoming);
    } else {
      await addContact(incoming);
    }
  }

  async function run(): Promise<ImportOutcome> {
    isRunning.value = true;
    try {
      const contacts = await appContactsSrvProxy.getSharedContactsImport(importId);
      if (!contacts) {
        return 'not-found';
      }

      total.value = contacts.length;
      for (const incoming of contacts) {
        if (isAborted) {
          break;
        }

        try {
          await processContact(incoming);
        } catch (err) {
          await w3n.log('error', `Fail to import contact ${incoming.mail}`, err);
          stats.value.skipped += 1;
        }

        if (!isAborted) {
          processed.value += 1;
        }
      }

      return isAborted ? 'aborted' : 'done';
    } finally {
      isRunning.value = false;
      await appContactsSrvProxy.finishSharedContactsImport(importId).catch(() => undefined);
    }
  }

  return {
    total,
    processed,
    percent,
    stats,
    conflict,
    isRunning,
    run,
    decide,
    abort,
  };
}
