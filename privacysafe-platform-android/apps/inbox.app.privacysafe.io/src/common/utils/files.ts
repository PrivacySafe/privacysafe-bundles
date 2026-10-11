/*
 Copyright (C) 2025 3NSoft Inc.

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
import { Nullable } from '@v1nt1248/3nclient-lib';
import { inboxSrv } from '@common/services/services-provider';
import type { AttachmentInfo } from '@common/types';

/**
 * The file an attachment record points at, or null when there is nothing to
 * read.
 *
 * Null rather than a rejection: an attachment can legitimately have no readable
 * file — a reference to a file the user has moved or deleted, a record of an
 * incoming attachment whose message is gone, or a file attached on another
 * device of the user — and every caller here already renders "nothing to show"
 * for null. Letting it throw instead turned an expected state into an unhandled
 * rejection.
 */
export async function getFileByInfoFromMsg(
  attachment: AttachmentInfo,
  incomingMsgId?: string,
): Promise<Nullable<web3n.files.ReadonlyFile>> {
  const { id, fileName, type, originMsgId, hasNoLocalSource } = attachment;

  // First of all: the bytes are on another device of the user, and no read here
  // can produce them.
  if (hasNoLocalSource) {
    return null;
  }

  // An attachment of an incoming message is found by message and name, not by
  // id. `originMsgId` covers the same record carried into a forward, before the
  // form has copied the file into the store.
  const msgIdToReadFrom = incomingMsgId ?? (type === 'origin' ? originMsgId : undefined);
  if (msgIdToReadFrom) {
    return await inboxSrv.getIncomingAttachment(msgIdToReadFrom, fileName).catch(() => null);
  }

  // No `id || fileName` fallback: an id is what the store is keyed by, and
  // looking a file up by its name silently asked for an id that cannot exist.
  if (!id) {
    return null;
  }
  const file = await inboxSrv.getFile(id).catch(() => null);
  return file || null;
}
