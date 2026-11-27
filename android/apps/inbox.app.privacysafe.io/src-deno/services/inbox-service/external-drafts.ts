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
import { makeLogger } from '../../../shared/utils/logger.ts';
import { randomIdStr } from '../../../shared/utils/random-id.ts';
import { MAX_ATTACHMENT_SIZE } from '../../../shared/constants/attachment-limits.ts';
import type { AttachmentInfo, PreparedMessageData } from '../../../src/common/types/mail.types.ts';
import type { ExternalDraftFile } from '../../../src/common/types/external-inbox.types.ts';
import type { InboxSrv } from '../../types/inbox-srv.types.ts';

const log = makeLogger('ExternalDrafts');

/**
 * How long a draft prepared by another app waits for the inbox window to take
 * it. The window is opened by that app right after the draft is made, so a
 * draft still here after this time belongs to a window that never came, and
 * its copied files would otherwise stay in the store forever.
 */
const DRAFT_TTL_MILLIS = 10 * 60_000;

const MAX_DRAFT_RECIPIENTS = 1000;
const MAX_DRAFT_FILES = 100;
/** Drafts are taken by the window a moment after they are made. */
const MAX_PENDING_DRAFTS = 20;

/**
 * Drafts of messages that other apps (e.g. Contacts sharing contacts) hand to
 * the inbox: files are copied into the file store here, in the background,
 * and the inbox window picks the draft up by its id from the 'open-inbox-with'
 * command, to open the message creation dialog with it.
 *
 * Drafts live in memory only: they are a hand-over between two calls a moment
 * apart, not something to survive a restart of the component.
 */
export function externalDrafts(fileStore: Pick<InboxSrv, 'addFile' | 'deleteFile'>) {
  const drafts = new Map<string, PreparedMessageData>();

  async function dropDraft(draftId: string): Promise<void> {
    const draft = drafts.get(draftId);
    if (!draft) {
      return;
    }

    drafts.delete(draftId);
    for (const { id } of draft.attachmentsInfo || []) {
      if (id) {
        await fileStore.deleteFile(id).catch(err =>
          log.error(`Fail to remove a stored file ${id} of an expired external draft`, err),
        );
      }
    }
  }

  async function prepareDraft(
    { recipients, subject, files }: { recipients: string[]; subject?: string; files: ExternalDraftFile[] },
  ): Promise<{ draftId: string }> {
    if (!Array.isArray(recipients) || (recipients.length > MAX_DRAFT_RECIPIENTS)
      || recipients.some(r => !r || (typeof r !== 'string'))) {
      throw new Error(`Invalid recipients of an external draft`);
    }
    // Another app calls this; files are copied into this app's store, so what it
    // may hand over is bounded like what the user may attach (audit of 2026-11-26).
    if ((files || []).length > MAX_DRAFT_FILES) {
      throw new Error(`Too many files in an external draft`);
    }
    if (drafts.size >= MAX_PENDING_DRAFTS) {
      throw new Error(`Too many external drafts waiting to be opened`);
    }

    const draftId = randomIdStr(32);
    const attachmentsInfo: AttachmentInfo[] = [];
    try {
      for (const { file, name } of files || []) {
        const fileName = name || file.name;
        const { size = 0 } = await file.stat();
        if (size > MAX_ATTACHMENT_SIZE) {
          throw new Error(`A file of an external draft is larger than an attachment may be`);
        }
        // A copy, not a link: the caller's file is a temporary one, and it is
        // removed as soon as this call returns.
        const id = await fileStore.addFile(file, { fileName, messages: [draftId] });
        attachmentsInfo.push({ id, fileName, size });
      }
    } catch (err) {
      for (const { id } of attachmentsInfo) {
        await fileStore.deleteFile(id!).catch(() => {});
      }
      throw err;
    }

    drafts.set(draftId, {
      id: draftId,
      threadId: randomIdStr(32),
      recipients,
      subject: subject || '',
      attachmentsInfo,
      htmlTxtBody: '',
    });
    setTimeout(() => dropDraft(draftId), DRAFT_TTL_MILLIS);

    log.info(`External draft ${draftId} prepared: ${attachmentsInfo.length} file(s)`);
    return { draftId };
  }

  async function takePreparedDraft(draftId: string): Promise<PreparedMessageData | undefined> {
    const draft = drafts.get(draftId);
    // From here on the stored files belong to the message creation dialog.
    drafts.delete(draftId);
    return draft;
  }

  return {
    prepareDraft,
    takePreparedDraft,
  };
}
