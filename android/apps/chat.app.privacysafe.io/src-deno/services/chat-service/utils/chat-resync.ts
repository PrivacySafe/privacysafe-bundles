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
 * Recovery of whole chats a device never got: the initial snapshot of a new
 * device, and the chats its orphan buffer waits for.
 *
 * Phantoms carry changes, and the change that brings a chat into being - its
 * creation phantom, or the peer's invitation - is in the shared inbox for 15
 * days at most. A device added later never learns of an older chat, and every
 * later phantom of that chat buffers as an orphan waiting for a chat that does
 * not come (a desktop added to an Android user, 2026-11-09: the chat 'mikalai'
 * of 2026-10-05 never appeared, and the message sent to it from the phone
 * buffered for 'chat-creation').
 *
 * Same shape as msg-resync.ts, one level up: the device that misses chats asks
 * its own other devices ('resync:chats'), and a device that has them answers
 * with a snapshot of those chats - the `restore:snapshot` carrier in `merge`
 * mode with `applyNewerAspects`, applied by applyRestoreSnapshot(). So the
 * merge rules are the restore's, and there is no second set of them.
 *
 * When this device asks:
 *  - while it is new, for all chats: on its first run, and again on later
 *    starts (at most hourly, for up to 15 days) until an answer to any of its
 *    asks arrives (initialChatsSnapshot in the local data file). One ask was
 *    not enough: on 2026-11-09 the only device with chats was on an older
 *    build when the ask came, and nothing ever asked again;
 *  - when a phantom of a chat it does not have is buffered, for that chat;
 *  - in the start-up pass, for every chat the orphan buffer still waits for.
 */

import type { ChatIdObj, ResyncChatsSysMsgData } from '../../../../types/asmail-msgs.types.ts';
import { chatIdToString } from '../../../../shared-libs/chat-ids.ts';
import { generateFastRandomString } from '../../../../shared-libs/generate-random-string.ts';
import { isExpiredRecord } from '../../backup-service/backup-records.ts';
import { makeSystemEventPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import type { ResyncCtx } from './msg-resync.ts';
import { announceSnapshot, readSnapshotFromDb } from './snapshot-announce.ts';
import { chatEntityId } from './sync-versions.ts';

/** Key of the ask for all chats in ResyncCtx.requestedChats. */
const ALL_CHATS = '*';

/** An answer's snapshot id is this prefix plus the id of the ask it answers. */
const RESYNC_SNAPSHOT_PREFIX = 'resync-';

/**
 * Key under which an answer to an ask for ALL chats is remembered, besides
 * the ask's own id: a new device repeats that ask until it is answered, and
 * a device that comes online with several of the repeats in its inbox must
 * not send its whole history once per repeat.
 */
function allChatsAnswerKey(askingDeviceId: string): string {
  return `all@${askingDeviceId}`;
}

/**
 * Most chats named in one ask. More than this many missing chats is a device
 * that should have asked for all of them; the rest go in the next session.
 */
export const MAX_CHATS_PER_RESYNC_ASK = 50;

/** How long an answer that yields to a call waits before trying again. */
const BUSY_ANSWER_RETRY_MILLIS = 5 * 60_000;

/**
 * Asks the user's other devices for the given chats, or - with no list - for
 * all of their chats.
 *
 * Returns the id of the ask, or undefined when none went out: every chat
 * named is already here, was asked for in this session, or was deleted here (a
 * tombstone would make the answer a no-op anyway); or a call is on, in which
 * case nothing is marked and a later pass asks again. Failures are logged and
 * never thrown - asking must not break the processing that noticed the
 * missing chat.
 */
export async function requestChatsResync(
  ctx: ResyncCtx,
  chatIds?: ChatIdObj[],
): Promise<string | undefined> {
  let wanted: ChatIdObj[] | undefined;
  if (chatIds) {
    if (ctx.requestedChats.has(ALL_CHATS)) {
      // Everything was asked for already in this session.
      return undefined;
    }
    const seen = new Set<string>();
    wanted = chatIds.filter(chatId => {
      const key = chatIdToString(chatId);
      if (seen.has(key) || ctx.requestedChats.has(key)) {
        return false;
      }
      seen.add(key);
      return !ctx.db.findChat(chatId)
        && !ctx.db.getSyncVersion('chat', chatEntityId(chatId), 'deleted');
    }).slice(0, MAX_CHATS_PER_RESYNC_ASK);
    if (wanted.length === 0) {
      return undefined;
    }
  } else if (ctx.requestedChats.has(ALL_CHATS)) {
    return undefined;
  }

  if (ctx.isBusy?.()) {
    return undefined;
  }

  const requestId = generateFastRandomString(12);
  for (const chatId of wanted ?? []) {
    ctx.requestedChats.add(chatIdToString(chatId));
  }
  if (!wanted) {
    ctx.requestedChats.add(ALL_CHATS);
  }

  try {
    await queueSyncPhantom({
      db: ctx.db,
      ownAddr: ctx.ownAddr,
      phantom: makeSystemEventPhantom({
        // The envelope's chat is read only by an older build, in its
        // `chatRequired` gate: a chat it has makes it log one warning, a chat
        // it lacks makes it buffer the ask - harmless, and dropped in 15 days.
        chatId: wanted?.[0] ?? { isGroupChat: false, chatId: ctx.ownAddr },
        sourceDeviceId: ctx.getAppDeviceId(),
        timestamp: await ctx.nextSyncStamp(),
        chatSystemData: {
          event: 'resync:chats',
          value: {
            requestId,
            ...(wanted && { chatIds: wanted }),
          },
        },
      }),
      entity: { entityType: 'chat', entityId: `resync-chats/${requestId}`, aspect: 'snapshot' },
    });
    await w3n.log(
      'info',
      wanted
        ? `Asked other devices for ${wanted.length} chat(s) this device does not have `
          + `(${wanted.map(chatIdToString).join(', ')}), request ${requestId}`
        : `Asked other devices for all of their chats (new device, no answer yet), request ${requestId}`,
    );
    return requestId;
  } catch (err) {
    await w3n.log('error', `Failed to ask other devices for chats, request ${requestId}`, err);
    return undefined;
  }
}

/**
 * The ask for all chats of a new device, when one is due: no answer has come
 * to its earlier asks, the last one is old enough, and the asking window is
 * not over (see isInitialChatsSnapshotAskDue in the local data store).
 */
export async function requestInitialChatsSnapshot(ctx: ResyncCtx): Promise<void> {
  const state = ctx.chatsResyncState;
  if (!state || !(await state.isInitialAskDue())) {
    return;
  }
  const requestId = await requestChatsResync(ctx);
  if (requestId) {
    await state.noteInitialAsked(requestId);
  }
}

/**
 * Called for every chunk of a snapshot that answers a 'resync:chats' ask:
 * an answer to one of this device's asks for all chats ends its wait, and no
 * more such asks go out.
 */
export async function noteChatsResyncAnswer(
  ctx: ResyncCtx,
  snapshotId: string,
  answeringDeviceId: string,
): Promise<void> {
  if (!snapshotId.startsWith(RESYNC_SNAPSHOT_PREFIX)) {
    return;
  }
  const requestId = snapshotId.substring(RESYNC_SNAPSHOT_PREFIX.length);
  if (await ctx.chatsResyncState?.noteInitialAnswered(requestId)) {
    await w3n.log(
      'info',
      `Device ${answeringDeviceId} answered the ask for all chats (request ${requestId}); not asking any more`,
    );
  }
}

/**
 * Start-up pass: the first-run ask if still pending, then one ask for the
 * chats the orphan buffer waits for.
 */
export async function requestChatsResyncAtStartup(ctx: ResyncCtx): Promise<void> {
  await requestInitialChatsSnapshot(ctx);
  const missing = ctx.db.getChatlessOrphanChatIds();
  if (missing.length > 0) {
    await requestChatsResync(ctx, missing);
  }
}

/**
 * Answers a 'resync:chats' ask from another device of this user: sends the
 * chats asked for (all of them, if none are named) with their histories, as a
 * snapshot; stays silent when it has none of them.
 *
 * Answered once per ask, ever - the answer is a whole history, and the ask is
 * replayed by catch-up scans for as long as it is in the shared inbox. An
 * answer that has to yield to a call is retried within the session; failing
 * that, the next replay of the ask answers it.
 */
export async function respondToChatsResync(
  ctx: ResyncCtx,
  value: ResyncChatsSysMsgData['value'],
  askingDeviceId: string,
): Promise<void> {
  const { requestId, chatIds } = value;
  const state = ctx.chatsResyncState;
  if (!requestId || state?.wasAnswered(requestId)) {
    return;
  }
  // An ask for all chats is repeated by a new device until it is answered;
  // this device answers that device once.
  const deviceKey = chatIds ? undefined : allChatsAnswerKey(askingDeviceId);
  if (deviceKey && state?.wasAnswered(deviceKey)) {
    await state.noteAnswered(requestId);
    await w3n.log(
      'info',
      `Chats resync ${requestId} of device ${askingDeviceId}: all chats were already sent to that device`,
    );
    return;
  }

  if (ctx.isBusy?.()) {
    // A snapshot is many messages; it must not compete with the signalling of
    // a call that is on.
    if (!ctx.deferredChatsAnswers.has(requestId)) {
      ctx.deferredChatsAnswers.add(requestId);
      setTimeout(() => {
        ctx.deferredChatsAnswers.delete(requestId);
        respondToChatsResync(ctx, value, askingDeviceId).catch(err =>
          w3n.log('error', `Deferred answer to chats resync ${requestId} failed`, err).catch(() => {}),
        );
      }, BUSY_ANSWER_RETRY_MILLIS);
    }
    return;
  }

  try {
    const { chats, msgs } = readSnapshotFromDb(ctx.db, chatIds);
    // Records past their auto-deletion time would only be skipped there.
    const now = Date.now();
    const liveMsgs = msgs.filter(({ record }) => !isExpiredRecord(record, now));

    let chunks = 0;
    if (chats.length > 0) {
      chunks = await announceSnapshot({
        db: ctx.db,
        ownAddr: ctx.ownAddr,
        sourceDeviceId: ctx.getAppDeviceId(),
        snapshotId: `${RESYNC_SNAPSHOT_PREFIX}${requestId}`,
        mode: 'merge',
        snapshotTs: await ctx.nextSyncStamp(),
        applyNewerAspects: true,
        chats,
        msgs: liveMsgs,
      });
    }

    // Remembered even when this device had nothing to send: the answer to a
    // replay of the same ask would be the same silence. The device key only
    // when something was sent - a device that had nothing then may have chats
    // by the time the next repeat comes.
    await state?.noteAnswered(requestId);
    if (deviceKey && (chats.length > 0)) {
      await state?.noteAnswered(deviceKey);
    }
    await w3n.log(
      'info',
      (chats.length > 0)
        ? `Answered chats resync ${requestId} of device ${askingDeviceId}: ${chats.length} chat(s), `
          + `${liveMsgs.length} message(s) in ${chunks} chunk(s)`
        : `Chats resync ${requestId} of device ${askingDeviceId}: none of the chats asked for are here`,
    );
  } catch (err) {
    await w3n.log('error', `Failed to answer chats resync ${requestId} of device ${askingDeviceId}`, err);
  }
}
