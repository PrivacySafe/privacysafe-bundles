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
 * Recovery of message records whose sync carrier never arrived.
 *
 * A buffered orphan (see bufferOrphanedSync) assumes its target record is on
 * its way. That assumption can silently fail: an inbox message can be lost for
 * good (e.g. a delivery that was started and never completed is unretrievable
 * by every device), and then the orphan just ages out - the record exists on
 * other devices, this one never learns of it.
 *
 * This module makes the wait active: the device missing a record asks its own
 * other devices to repeat the record's phantom ('resync:msg-record' event, own
 * -devices channel only), and a device that has the record answers with a
 * repeated record phantom. Receiving a repeated record is idempotent, so
 * duplicate answers from several devices are safe; the answer carries the
 * record's original timestamp, so it cannot outrank changes made since.
 */

import {
  makeSystemEventPhantom,
  queueSyncPhantom,
} from '../../mail-sending-service/index.ts';
import {
  createSyncMsgBasedOnInvitationMsg,
  createSyncMsgBasedOnRegularMsg,
  createSyncMsgBasedOnSystemMsg,
} from './_msgs-related-methods.ts';
import { msgEntityId } from './sync-versions.ts';
import type {
  ChatIdObj,
  ChatInvitationMsgV1,
  ChatSystemMsgV1,
} from '../../../../types/asmail-msgs.types.ts';
import type { DB } from '../../../types/index.ts';
import type { SyncPhantom } from '../../mail-sending-service/sync-phantoms.ts';
import { MAX_RESYNC_ASKS_PER_SESSION } from '../../../../shared-libs/constants/index.ts';

export interface ResyncCtx {
  db: DB;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
  /**
   * Targets already asked for in this session. One ask per session is enough:
   * every start-up repeats the ask for still-missing targets, so a record that
   * can be recovered is recovered, and one that cannot (no device has it) is
   * not asked for on every arriving update.
   */
  requestedTargets: Set<string>;
  /**
   * Targets already answered in this session. Asks live in the shared inbox
   * for as long as any other message, so a catch-up scan can replay one long
   * after it was answered - without this, every replay would send the record
   * again.
   */
  answeredTargets: Set<string>;
  /**
   * Tells that resync traffic must yield right now - a call is going on, and
   * its signalling shares the same ASMail delivery. Both asking and answering
   * step aside without marking their target done, so the work is picked up
   * when the coast is clear. Mutable: the check becomes available only after
   * the video chat service starts (see setResyncBusyCheck in chat-service.ts).
   */
  isBusy?: () => boolean;
}

export function makeResyncCtx(
  ctx: Omit<ResyncCtx, 'requestedTargets' | 'answeredTargets'>,
): ResyncCtx {
  return { ...ctx, requestedTargets: new Set(), answeredTargets: new Set() };
}

/**
 * Asks the user's other devices to repeat the record of the given message.
 * Failure to ask must never break the processing that noticed the missing
 * record, so errors are only logged.
 *
 * Returns false when the ask was not sent - because it already went out this
 * session, the per-session cap is reached, or a call is on. Only the first of
 * those marks the target as requested; the other two leave it for a later
 * pass or the next session.
 */
export async function requestMsgRecordResync(
  ctx: ResyncCtx,
  chatId: ChatIdObj,
  chatMessageId: string,
): Promise<boolean> {
  const entityId = msgEntityId(chatId, chatMessageId);
  if (ctx.requestedTargets.has(entityId)) {
    return false;
  }
  if (ctx.isBusy?.()) {
    return false;
  }
  if (ctx.requestedTargets.size >= MAX_RESYNC_ASKS_PER_SESSION) {
    return false;
  }
  ctx.requestedTargets.add(entityId);

  try {
    await queueSyncPhantom({
      db: ctx.db,
      ownAddr: ctx.ownAddr,
      phantom: makeSystemEventPhantom({
        chatId,
        sourceDeviceId: ctx.getAppDeviceId(),
        timestamp: await ctx.nextSyncStamp(),
        chatSystemData: {
          event: 'resync:msg-record',
          value: { chatMessageId },
        },
      }),
      entity: { entityType: 'msg', entityId, aspect: 'record' },
    });
    await w3n.log('info', `Requested resync of message record ${chatMessageId}`);
    return true;
  } catch (err) {
    await w3n.log('error', `Failed to request resync of message record ${chatMessageId}`, err);
    return false;
  }
}

/**
 * Answers a 'resync:msg-record' ask: repeats the record's phantom if this
 * device has the record, stays silent if it doesn't. The phantom carries the
 * record's own timestamp - the answer restores a lost record, it must not
 * outrank changes made after that record was created.
 */
export async function respondToMsgRecordResync(
  ctx: ResyncCtx,
  chatId: ChatIdObj,
  chatMessageId: string,
): Promise<void> {
  const entityId = msgEntityId(chatId, chatMessageId);
  if (ctx.answeredTargets.has(entityId)) {
    // An ask stays in the shared inbox and can be replayed by a catch-up scan
    // long after it was answered; once per session is enough.
    return;
  }
  if (ctx.isBusy?.()) {
    // A record is a sizeable message; it must not compete with the signalling
    // of a call that is on. The asker repeats the ask on its next start.
    return;
  }

  const msg = await ctx.db.getMessage({ chatId, chatMessageId });
  if (!msg) {
    return;
  }

  const sourceDeviceId = ctx.getAppDeviceId();
  let phantom: SyncPhantom;

  if (msg.chatMessageType === 'regular') {
    phantom = createSyncMsgBasedOnRegularMsg({ msg, sourceDeviceId, timestamp: msg.timestamp });
  } else if (msg.chatMessageType === 'system') {
    let chatSystemData: ChatSystemMsgV1['chatSystemData'];
    try {
      chatSystemData = JSON.parse(msg.body!);
    } catch {
      return;
    }
    phantom = createSyncMsgBasedOnSystemMsg({
      chatId,
      sourceDeviceId,
      timestamp: msg.timestamp,
      msg: {
        v: 1,
        chatMessageType: 'system',
        chatMessageId,
        groupChatId: msg.groupChatId || undefined,
        chatSystemData,
      },
    });
  } else if (msg.chatMessageType === 'invitation') {
    let inviteData: ChatInvitationMsgV1['inviteData'];
    try {
      inviteData = JSON.parse(msg.body!);
    } catch {
      return;
    }
    phantom = createSyncMsgBasedOnInvitationMsg({
      chatId,
      sourceDeviceId,
      timestamp: msg.timestamp,
      msg: { chatMessageId, inviteData },
    });
  } else {
    return;
  }

  try {
    await queueSyncPhantom({
      db: ctx.db,
      ownAddr: ctx.ownAddr,
      phantom,
      entity: { entityType: 'msg', entityId, aspect: 'record' },
    });
    ctx.answeredTargets.add(entityId);
    await w3n.log('info', `Answered resync ask for message record ${chatMessageId}`);
  } catch (err) {
    await w3n.log('error', `Failed to answer resync ask for message record ${chatMessageId}`, err);
  }
}

/**
 * Start-up pass: repeats the ask for every record that buffered orphans are
 * still waiting for, up to the per-session cap. Together with the per-session
 * dedup in requestMsgRecordResync() this gives a retry-with-backoff shaped by
 * app restarts, with no extra state.
 *
 * Not part of the start-up critical path: it is fired on a delay, and skipped
 * outright while a call is on (see the timer in src-deno/index.ts) - resync
 * asks share ASMail delivery with the call's signalling.
 */
export async function requestResyncForStuckOrphans(ctx: ResyncCtx): Promise<void> {
  const targets = ctx.db.getStuckOrphanTargets();
  if (targets.length === 0) {
    return;
  }

  await w3n.log('info', `Asking other devices for ${targets.length} message record(s) buffered orphans wait for`);

  let sent = 0;
  for (const { chatId, targetMessageId } of targets) {
    if (await requestMsgRecordResync(ctx, chatId, targetMessageId)) {
      sent += 1;
    }
  }

  if (sent < targets.length) {
    await w3n.log(
      'info',
      `Resync pass sent ${sent} ask(s) of ${targets.length}; the rest waits for the next session`,
    );
  }
}
