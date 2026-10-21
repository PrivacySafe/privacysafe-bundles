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

/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
/// <reference path="../../../@types/platform-defs/test-stand.d.ts" />

import { generateOutgoingMsgId } from '../../../shared-libs/chat-ids.ts';
import { flushDb } from '../../dataset/db-flush.ts';
import { withoutBlockedRecipients } from '../../../shared-libs/blocked-recipients.ts';
import type {
  ChatIdObj,
  ChatInvitationMsgV1,
  ChatOutgoingMessage,
  ChatRegularMsgV1,
  ChatSystemMsgV1,
  LocalMetadataInDelivery,
  RelatedMessage,
} from '../../../types/index.ts';

/**
 * Adds a message to the delivery queue for sending.
 *
 * @param message - The outgoing message to send
 * @param recipients - List of recipient addresses
 * @param localMeta - Local metadata for tracking the message
 * @returns The delivery ID for tracking
 */
/**
 * Delivery id for a sync phantom, issued by the caller.
 *
 * A phantom's journal row is registered as "inside this delivery" before the
 * delivery starts (see phantom-flight.ts), which means the id has to exist
 * beforehand. The `sync_` prefix stays defined in one place.
 */
export function newSyncPhantomDeliveryId(): string {
  return generateOutgoingMsgId(undefined, 'sync_');
}

export async function addMessageToDeliveryList(
  message: ChatOutgoingMessage,
  recipients: string[],
  localMeta: LocalMetadataInDelivery,
  presetDeliveryId?: string,
): Promise<string> {
  const { jsonBody } = message;
  const { chatMessageId, chatMessageType } = jsonBody;

  // Sync phantoms must never share an id-space with the regular message they
  // describe: chatMessageId isn't set at the top level of a sync phantom's
  // body today, which accidentally keeps their ids from colliding, but that's
  // not an invariant to depend on - make the separation explicit instead.
  const deliveryId = presetDeliveryId ?? generateOutgoingMsgId(
    chatMessageId,
    chatMessageType === 'synchronization' ? 'sync_' : undefined,
  );

  // Blocked addresses are dropped here rather than where each caller builds
  // its recipient list; see blocked-recipients.ts. Sync phantoms address the
  // user's own address, which cannot be in the blacklist, so they pass through.
  const allowedRecipients = withoutBlockedRecipients(recipients);
  if (allowedRecipients.length === 0) {
    // Nothing is handed to the platform: a delivery with no recipients has
    // nothing to do, and what it would report back is not defined. The id is
    // still returned, so that a caller tracking this delivery keeps its
    // contract - it simply never sees progress for it.
    await w3n.log(
      'info',
      recipients.length === 0
        ? `Delivery ${deliveryId} is not started: it was given no recipients`
        : `Delivery ${deliveryId} is not started: every recipient of it is blocked (${recipients.join(', ')})`,
    );
    return deliveryId;
  }

  try {
    // Database writes are batched, so make sure what this message reflects is
    // on disk before it goes out. Both directions matter: a phantom whose
    // local change was lost would have the user's other devices apply a change
    // this one no longer has (and its sync token is already spent), and a
    // message delivered but not saved is the worst outcome of all.
    await flushDb();

    await w3n.mail!.delivery.addMsg(allowedRecipients, message, deliveryId, {
      sendImmediately: !message.attachments,
      localMeta,
    });
    return deliveryId;
  } catch (err) {
    await w3n.log('error', `Fail to add message to delivery`, err);
    throw new Error('Fail to add message to delivery', { cause: err });
  }
}

/**
 * Sends a system message.
 *
 * @param params - System message parameters
 * @returns The delivery ID for tracking
 */
export async function sendSystemMessage({
  chatId,
  recipients,
  chatMessageId,
  chatSystemData,
  isDeletable = false,
}: {
  chatId: ChatIdObj;
  recipients: string[];
  isDeletable?: boolean;
} & Pick<ChatSystemMsgV1, 'chatMessageId' | 'chatSystemData'>): Promise<string> {
  const jsonBody: ChatSystemMsgV1 = {
    v: 1,
    chatMessageType: 'system',
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    chatMessageId,
    chatSystemData,
  };
  const outMsg: ChatOutgoingMessage = {
    msgType: 'chat',
    jsonBody,
  };
  const deliveryMetadata: LocalMetadataInDelivery = {
    chatId,
    chatMessageType: 'system',
    chatMessageId,
    chatSystemData,
    isDeletable,
  };

  return await addMessageToDeliveryList(outMsg, recipients, deliveryMetadata);
}

/**
 * Sends a deletable system message.
 * The message will be deleted from delivery after sending, and a phantom sync message
 * will be sent if necessary (handled by handle-system-sending-progress).
 */
export async function sendSystemDeletableMessage({
  chatId,
  recipients,
  chatMessageId,
  chatSystemData,
}: {
  chatId: ChatIdObj;
  recipients: string[];
} & Pick<ChatSystemMsgV1, 'chatMessageId' | 'chatSystemData'>): Promise<void> {
  await sendSystemMessage({
    chatId,
    recipients,
    chatMessageId,
    chatSystemData,
    isDeletable: true,
  });
}

/**
 * Sends a chat invitation message.
 * The message will be removed from delivery after sending, and a phantom sync message
 * will be sent (handled by handle-invitation-sending-progress).
 */
export async function sendChatInvitation(
  chatId: ChatIdObj,
  recipients: string[],
  invitationMsgData: Pick<ChatInvitationMsgV1, 'chatMessageId' | 'inviteData'>,
): Promise<void> {
  const { chatMessageId, inviteData } = invitationMsgData;
  const jsonBody: ChatInvitationMsgV1 = {
    v: 1,
    chatMessageType: 'invitation',
    chatMessageId,
    inviteData,
  };
  const outMsg: ChatOutgoingMessage = {
    msgType: 'chat',
    jsonBody,
  };
  const deliveryMetadata: LocalMetadataInDelivery = {
    chatId,
    chatMessageType: 'invitation',
    chatMessageId,
    isDeletable: false,
  };

  await addMessageToDeliveryList(outMsg, recipients, deliveryMetadata);
}

/**
 * Sends system messages notifying recipients about their removal from a chat.
 */
export async function sendSysMsgsAboutRemovalFromChat(
  chatId: ChatIdObj,
  recipients: string[],
  chatDeleted?: true,
): Promise<void> {
  await Promise.allSettled(
    recipients.map(recipient =>
      sendSystemDeletableMessage({
        chatId,
        recipients: [recipient],
        chatSystemData: {
          event: 'member-removed',
          chatDeleted,
        },
      }),
    ),
  );
}

/**
 * Sends a system message indicating that the user is leaving a chat.
 */
export async function sendSysMsgToLeaveChat(
  chatId: ChatIdObj,
  chatMessageId: string,
  recipients: string[],
): Promise<string> {
  return sendSystemMessage({
    chatId,
    chatMessageId,
    recipients,
    chatSystemData: {
      event: 'member-left',
    },
  });
}

/**
 * Sends a regular chat message.
 *
 * @returns The delivery ID for tracking
 */
export async function sendRegularMessage(
  chatId: ChatIdObj,
  chatMessageId: string,
  recipients: string[],
  text: string,
  attachments: ChatOutgoingMessage['attachments'],
  relatedMessage: RelatedMessage | undefined,
  recordings?: ChatRegularMsgV1['recordings'],
): Promise<string> {
  const jsonBody: ChatRegularMsgV1 = {
    v: 1,
    chatMessageType: 'regular',
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    chatMessageId,
    relatedMessage,
    // Left out entirely when there is none, rather than sent as an empty
    // object: an older build ignores the field either way, but the wire form
    // of a message without recordings must not change.
    ...(recordings && { recordings }),
  };

  const outMsg: ChatOutgoingMessage = {
    msgType: 'chat',
    jsonBody,
    plainTxtBody: text,
    attachments,
  };

  const deliveryMetadata: LocalMetadataInDelivery = {
    chatId,
    chatMessageType: 'regular',
    chatMessageId,
  };

  return addMessageToDeliveryList(outMsg, recipients, deliveryMetadata);
}
