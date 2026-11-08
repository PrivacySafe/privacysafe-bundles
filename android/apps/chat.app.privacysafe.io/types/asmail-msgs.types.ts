/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
import type {
  AttachmentRecordingInfo,
  ChatMessageAttachmentsInfo,
  ChatMessageHistory,
  ChatMessageReaction,
  GroupChatStatus,
  MessageStatus,
  OutgoingMessageStatus,
  SingleChatStatus,
} from './chat.types.ts';
import type { ChatSettings, MsgDbEntry } from '../src-deno/types/index.ts';
// A type-only cycle with backup.types.ts, which names its records by ChatIdObj
// from here. Erased at compile time, and the alternative - restating the shape
// of a snapshot entry - is how the wire form and the archive form would drift.
import type { SnapshotChatEntry, SnapshotMsgEntry } from './backup.types.ts';

export type ASMailSendException = web3n.asmail.ASMailSendException;
export type ServLocException = web3n.ServLocException;
export type ConnectException = web3n.ConnectException;

export interface MessageDeliveryInfo {
  msgId: string;
  status: OutgoingMessageStatus;
  value: string | number;
}

export interface SendingMessageStatus {
  msgId?: string;
  status: web3n.asmail.DeliveryProgress | undefined;
  info: MessageDeliveryInfo | undefined;
}

export interface SendingError {
  mail: string;
  text: string;
}

export interface ChatMessageJsonBodyV1Base {
  v: 1;

  /**
   * groupChatId of a group chat. Missing id implies one-to-one chat, whose id
   * is then the sender's address, taken from the envelope. Invitations and
   * synchronizations don't have this field: they state their chat outright in
   * `chatId` (ChatSyncMsgV1), because a message addressed to one's own address
   * has no peer address to derive it from. Signals of a call do both - see
   * ChatWebRTCMsgV1.chatId.
   */
  groupChatId?: string;
}

export interface ChatSystemMsgV1 extends ChatMessageJsonBodyV1Base {
  chatMessageType: 'system';
  chatSystemData: ChatSystemMessageData;

  /**
   * chatMessageId is a unique identifier within given chat.
   * Expected form is an epoch in 100's of seconds, dash, short random part,
   * e.g. `${Math.floor(Date.now()/(100*1000))}-${randomString}` yielding
   * something like 17469720-eAkJmPpW.
   * This value is expected to be present on those system action that need
   * to be displayed, and thus, kept in a database.
   */
  chatMessageId?: string;
}

export interface ChatRegularMsgV1 extends ChatMessageJsonBodyV1Base {
  chatMessageType: 'regular';

  /**
   * chatMessageId is a unique identifier within given chat. It is useful for
   * database and referencing messages.
   * Expected form is an epoch in 100's of seconds, dash, short random part,
   * e.g. `${Math.floor(Date.now()/(100*1000))}-${randomString}` yielding
   * something like 17469720-eAkJmPpW.
   */
  chatMessageId: string;

  relatedMessage?: RelatedMessage;

  /**
   * Media recorded in the app, keyed by the name of the attachment carrying it.
   *
   * An optional field on the existing 'regular' type, and deliberately not a
   * new chatMessageType: checkV1() answers `undefined` for a type it does not
   * know, and a build that gets such a message deletes it from the shared
   * inbox outright (the same reasoning as for RestoreSnapshotSysMsgData
   * below). An unknown field on a known type is simply ignored, so an older
   * correspondent sees an ordinary audio or video attachment instead.
   *
   * Keyed by name rather than being one field for the whole message because
   * the receiving side rebuilds its attachment list from the ASMail
   * attachments folder, where `listFolder` promises no order, and the
   * container puts files in by name (`addFileTo(container, file, name)`).
   *
   * `durationMs` travels because it cannot be recovered from the file - see
   * AttachmentRecordingInfo. `preview` travels because a video message is far
   * past THUMBNAIL_AUTO_PREVIEW_LIMIT, so without it neither the recipient nor
   * the sender would see a frame until the whole file had been read; both sides
   * put it into their preview table rather than into the message record.
   */
  recordings?: Record<string, RecordedMediaInMsg>;
}

export interface RecordedMediaInMsg extends AttachmentRecordingInfo {
  /** Data URL of a small frame; only a video message has one. */
  preview?: string;
}

export interface ChatInvitationMsgV1 extends ChatMessageJsonBodyV1Base {
  chatMessageType: 'invitation';

  /**
   * For invitation chatMessageId is generated like for any other message.
   * When new member is added, chatMessageId in invitation should be the
   * same as chatMessageId in system message that added new member, providing
   * continuity of record.
   */
  chatMessageId: string;

  inviteData: InvitationProcessMsgData;
}

export interface PhantomSyncMsgDataBasedOnRegularMsgV1 extends ChatRegularMsgV1 {
  text: string;

  /**
   * Absent when the message has no files. An empty array would be truthy on the
   * receiving device and read there as "there are files, but only on the device
   * that sent this" - phantoms of earlier builds do send [], so the receiving
   * side normalizes it away.
   */
  attachments?: ChatMessageAttachmentsInfo[];

  /**
   * Status of the message on the device that has originated it, at the moment
   * of sending this phantom. Phantom is sent optimistically, right after the
   * message is placed into a database of the originating device, i.e. before
   * the delivery to peers is done. Therefore, at this point status is usually
   * a non-terminal one ('sending'), and it is followed later by
   * 'update:msg-record' phantom with a terminal status ('sent' / 'error').
   * Field is optional for compatibility with phantoms of previous builds.
   */
  status?: MessageStatus;

  history?: ChatMessageHistory;

  /**
   * Set when the record being carried is of an *incoming* message. Fresh
   * records of incoming messages are not phantomed - every device reads the
   * peer's original from the shared inbox - but a resync answer (see
   * ResyncMsgRecordSysMsgData) repeats whatever record was asked for, and
   * without these fields an incoming message would be restored as the user's
   * own, with its sender lost.
   */
  isIncomingMsg?: boolean;

  /** Sender of an incoming message in a group chat, see isIncomingMsg. */
  groupSender?: string;
}

export interface ChatSyncMsgV1<
  T extends PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1,
> extends ChatMessageJsonBodyV1Base {
  chatMessageType: 'synchronization';
  chatMessageId?: string;
  sourceDeviceId: string;
  chatId: ChatIdObj;
  value: T;
  timestamp: number;
}

export type InvitationProcessMsgData =
  | GroupChatParameters
  | OneToOneChatParameters
  | AcceptedInvitationReference
  | UpdatedMembersInvitationData;

export interface GroupChatParameters {
  type: 'group-chat-invite';
  groupChatId: string;
  name: string;
  addr?: string;
  members?: Record<string, { hasAccepted: boolean }>;
  admins?: string[];

  /**
   * status and settings are only populated for the own-devices sync channel
   * (never sent to a peer as part of the actual invitation) - they let a
   * chat created from a sync phantom mirror the real local chat state
   * instead of guessing it.
   */
  status?: GroupChatStatus;
  settings?: ChatSettings;
}

/**
 * OneToOneChatParameters contains parameters of sending side, acting like a
 * contact card.
 */
export interface OneToOneChatParameters {
  type: 'oto-chat-invite';
  name: string;

  /**
   * status and settings are only populated for the own-devices sync channel,
   * see the matching comment on GroupChatParameters.
   */
  status?: SingleChatStatus;
  settings?: ChatSettings;
}

export type StoredInvitationParams =
  | AcceptedInvitationReference
  | ((GroupChatParameters | OneToOneChatParameters) & {
      neverContactedInitiator?: boolean;
    });

export interface AcceptedInvitationReference {
  type: 'invite-acceptance';

  /**
   * initiator is an address that has sent the original invitation: in a group
   * chat it is the sender of that invitation, in a one-to-one chat it is the
   * chat's peer. Not optional: it is always known to the accepting side, which
   * sends the acceptance to that very address.
   */
  initiator: string;

  /**
   * chatMessageId is same as in the original invitation.
   */
  chatMessageId: string;

  /**
   * groupChat is same as in the original invitation.
   */
  groupChat?: GroupChatParameters;

  /**
   * oneToOneChat contains contact parameters of invitation accepting side.
   */
  oneToOneChat?: OneToOneChatParameters;
}

export interface UpdatedMembersInvitationData {
  type: 'updated-members-invitation-data';
  chatId: ChatIdObj;
  members: string[];
}

export interface ChatWebRTCMsgV1 extends ChatMessageJsonBodyV1Base {
  chatMessageType: 'webrtc-call';
  chatMessageId?: string;

  /**
   * Chat this signal belongs to, stated outright rather than left to be derived
   * from the envelope. Same reason ChatSyncMsgV1 carries the field: a signal
   * addressed to the user's *own* address (see sendCallHandledElsewhere) would
   * otherwise be read as belonging to a one-to-one chat with oneself, which
   * does not exist - and the message would be discarded as "no known chat".
   *
   * Optional for compatibility with builds that predate it, which is also why
   * `groupChatId` keeps being sent alongside. Trusted only when the sender is
   * this very user: letting a peer name the chat would let it inject
   * signalling into a one-to-one chat it is not part of.
   */
  chatId?: ChatIdObj;

  webrtcMsg: WebRTCMsg;
}

export type ChatMessageJsonBody =
  | ChatSystemMsgV1
  | ChatRegularMsgV1
  | ChatInvitationMsgV1
  | ChatWebRTCMsgV1
  | ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>;

export type ChatMessageType = 'regular' | 'system' | 'invitation' | 'webrtc-call' | 'synchronization';

export interface RelatedMessage {
  replyTo?: {
    chatMessageId: string;
    displayedText?: string;
  };
  forwardFrom?: {
    sender: string;
  };
}

/**
 * System message to tell to delete chat message.
 * value field contains chatMessageId of a message that should be deleted.
 */
export interface DeleteMessageSysMsgData {
  event: 'delete:message';
  value: {
    oneMessage?: ChatMessageId;
    multipleMessages?: {
      chatMsgIds: ChatMessageId[];
    };
    allInChat?: ChatIdObj;
  };
}

export interface UpdateMembersSysMsgData {
  event: 'update:members';
  value: {
    membersToDelete: Record<string, { hasAccepted: boolean }>;
    membersToAdd: Record<string, { hasAccepted: boolean }>;
    membersAfterUpdate: Record<string, { hasAccepted: boolean }>;
  };
}

export interface UpdateAdminsSysMsgData {
  event: 'update:admins';
  value: {
    adminsToDelete: string[];
    adminsToAdd: string[];
    adminsAfterUpdate: string[];
  };
}

export interface UpdatedChatNameSysMsgData {
  event: 'update:chatName';
  value: {
    name: string;
  };
}

export interface UpdatedChatSettingsSysMsgData {
  event: 'update:settings';
  value: {
    settings: ChatSettings;
  };
}

export interface MemberLeftSysMsgData {
  /**
   * Sender of this message has left a chat.
   */
  event: 'member-left';
  value?: {
    sender: string;
  };
}

export interface MemberRemovalSysMsgData {
  /**
   * Recipient of this message is removed from membership in a chat.
   */
  event: 'member-removed';
  chatDeleted?: true;
}

export interface UpdatedMsgStatusSysMsgData {
  event: 'update:status';
  value: {
    chatMessageId: string;
    status: MessageStatus;
  };
}

export interface UpdatedMsgRecordSysMsgData {
  event: 'update:msg-record';
  value: {
    chatMessageId: string;
    data: Partial<MsgDbEntry> | null;
  };
}

export interface UpdatedMsgReactionSysMsgData {
  event: 'update:reactions';
  value: {
    chatMessageId: string;
    reactions: Record<string, ChatMessageReaction>;
  };
}

export interface UpdatedMsgBodySysMsgData {
  event: 'update:body';
  value: {
    chatMessageId: string;
    body: string;
  };
}

/**
 * Request to the user's own other devices to re-send the record of a message
 * this device doesn't have. Sent when an update phantom arrives for a record
 * that never did (its carrier lost in delivery), instead of waiting for a
 * record that can never come: the update sits in the orphan buffer, and this
 * is what refills the buffer's missing target.
 *
 * Travels only the own-devices sync channel (a phantom), never goes to peers.
 * Any device that has the record answers with a repeated record phantom; a
 * device that doesn't stays silent. Repeated answers and answers racing the
 * record's late arrival are safe: record creation is idempotent on the
 * receiving side (existing-record check, tombstones, ordering tokens).
 */
export interface ResyncMsgRecordSysMsgData {
  event: 'resync:msg-record';
  value: {
    chatMessageId: string;
  };
}

export interface AcceptedMsgBodySysMsgData {
  event: 'accept:invitation';
  value: {
    sender: string;
    status: GroupChatStatus | SingleChatStatus;
  };
}

export interface CallMsgBodySysMsgData {
  event: 'call';
  value: {
    sender: string;
    direction: 'incoming' | 'outgoing';
    endTimestamp?: number | null;
  };
}

/**
 * The user blocked, or unblocked, a contact they share a chat with.
 *
 * Purely local, and both halves of that are load-bearing. Such a record is
 * NEVER sent to peers - the blocked side is not told - and it is NEVER put
 * into a sync phantom either: the blacklist itself is replicated by the
 * contacts app, so the watcher fires on every device of the user and each one
 * writes its own record. Synchronizing on top of that would duplicate the line
 * and would put an event onto the wire that older builds do not know.
 *
 * `mail` is the canonical address, so that the record can be matched against
 * the blacklist without guessing how it was spelled when it was written.
 */
export interface ContactBlockedSysMsgData {
  event: 'contact:blocked';
  value: {
    mail: string;
  };
}

export interface ContactUnblockedSysMsgData {
  event: 'contact:unblocked';
  value: {
    mail: string;
  };
}

export interface WebRTCMsgBodySysMsgData {
  event: 'webrtc-call';
  value: {
    sender: string;
    /**
     * - 'outgoing-call-cancelled': the caller withdrew a call before it was
     *   answered;
     * - 'incoming-call-cancelled': somebody declined a ringing call;
     * - 'call-collision-failed': `sender` and the receiver started calls in this
     *   chat at the same moment, and the two calls never met (see
     *   callCollisionWinner in video-chat-service/utils/call-state.ts). Sent by
     *   the host whose call won and waited in vain; `callSessionId` is that
     *   host's call. Builds that predate it ignore it.
     */
    subType: 'outgoing-call-cancelled' | 'incoming-call-cancelled' | 'call-collision-failed';
    chatId: ChatIdObj;
    /**
     * Which call this is about - the same id as `WebRTCMsg.callSessionId`, so
     * that the two ways of hearing that a call was cancelled can be told apart
     * by the receiver.
     *
     * Needed because this message travels the ordinary delivery queue and stays
     * in the inbox long after it was first handled (a start-up catch-up scan
     * replays it), while the signal it backs up carries a session id and is
     * refused when it names a call the receiver is not in. Without the id, an
     * old cancellation was indistinguishable from a fresh one and ended the call
     * that had just started.
     *
     * Optional: builds that predate the field send none, and a cancellation with
     * no id is not acted upon beyond the chat history (see
     * admitsCallCancelSysMsg in video-chat-service/utils/call-state.ts).
     */
    callSessionId?: string;
  };
}

/**
 * One chunk of a restore snapshot, announced to the user's other devices.
 *
 * A new `system` event inside an ordinary `synchronization` phantom (`v: 1`),
 * and NOT a new chatMessageType or `v: 2`. That is forced, not stylistic:
 * checkChatMessageJSON() admits only `jsonBody.v === 1`, and checkV1() returns
 * undefined for a chatMessageType it does not know - and either answer makes an
 * older build remove the message from the shared inbox IMMEDIATELY, taking the
 * snapshot away from the newer devices that still need it. As a system event of
 * a known shape it passes validation on an old build, reaches handleSystemSync,
 * falls into its `default:` (one `w3n.log('warning')`) and is then scheduled for
 * REMOVAL IN 15 DAYS rather than at once.
 *
 * The chunks carry records and never bytes; an attachment travels as its name,
 * its size and `hasNoLocalSource`, with `incomingMsgId` standing in for the
 * bytes of a received message. See doc/08-backup-and-restore.md for the carrier
 * rule and why this app answers it differently from the mail app.
 */
export interface RestoreSnapshotSysMsgData {
  event: 'restore:snapshot';
  value: {
    /** The receiver applies the same rule the user chose at the source. */
    mode: 'replace' | 'merge';
    snapshotTs: number;
    /** Ties the chunks of one restore together, for the journal and the log. */
    restoreId: string;
    part: number;
    of: number;
    chats?: SnapshotChatEntry[];
    msgs?: SnapshotMsgEntry[];
    /**
     * Only in 'replace', and in every chunk. A FRESH token, minted once for the
     * whole restore, under which a `replace` re-creates a record that a
     * `historyCleared` marker would otherwise forbid.
     *
     * It travels rather than being minted per device for one reason: every
     * device applying this snapshot has to stamp the resurrected record with
     * the SAME token. Minted locally, two devices would write two different
     * versions of one aspect, and the next change to that record would be
     * ordered differently on each of them.
     *
     * Strictly older than `deleted.token` below, so that the invariant there -
     * a deletion wins over everything the same snapshot restores - still holds.
     */
    restoreToken?: { ts: number; deviceId: string };
    /**
     * Only in 'replace', and only in the last chunk. Carries a FRESH token: a
     * deletion has to win on the neighbours over everything the same snapshot
     * has just restored.
     */
    deleted?: {
      chatIds?: ChatIdObj[];
      msgIds?: ChatMessageId[];
      token: { ts: number; deviceId: string };
    };
  };
}

export type ChatSystemMessageData =
  | UpdateMembersSysMsgData
  | UpdateAdminsSysMsgData
  | MemberRemovalSysMsgData
  | MemberLeftSysMsgData
  | DeleteMessageSysMsgData
  | UpdatedChatNameSysMsgData
  | UpdatedChatSettingsSysMsgData
  | UpdatedMsgStatusSysMsgData
  | UpdatedMsgRecordSysMsgData
  | UpdatedMsgReactionSysMsgData
  | UpdatedMsgBodySysMsgData
  | AcceptedMsgBodySysMsgData
  | CallMsgBodySysMsgData
  | WebRTCMsgBodySysMsgData
  | ContactBlockedSysMsgData
  | ContactUnblockedSysMsgData
  | ResyncMsgRecordSysMsgData
  | RestoreSnapshotSysMsgData;

export interface WebRTCMsg {
  // XXX should we have more explicit stages here?
  // XXX explicit start and explicit close on non-webrtc will be more reliable

  // - stage: start, can be already with candidate(s) in first signalling.
  //          Collision of simultaneous starts: see callCollisionWinner in
  //          src-deno/services/video-chat-service/utils/call-state.ts.
  // - stage: signalling - just pass data
  // - stage: disconnect - close and send all appropriate notifications

  /**
   * stage
   * - start: initial call setup
   * - signalling: WebRTC negotiation
   * - disconnect: call termination
   * - heartbeat: periodic keepalive for active calls (re-join feature)
   */
  stage: 'start' | 'signalling' | 'disconnect' | 'heartbeat';
  id: number;
  /**
   * Identifies the call this signal belongs to: `<hostAddr>#<host counter>`.
   * Generated by the host when it creates the call and echoed by clients in
   * every signal of that call, so a signal of a finished call can be told
   * apart from a signal of the current one without guessing from its age.
   *
   * Optional for compatibility with builds that predate it: a signal without
   * the field falls back on the age-based rules (see call-state.ts).
   */
  callSessionId?: string;
  data: WebRTCOffBandMessage | WebRTCOffBandMessage[];
}

export interface WebRTCOffBandMessage {
  description?: RTCSessionDescription;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidate?: any;
  /**
   * Host address of an active call. Used in 'heartbeat' messages so that
   * participants who left can re-join as CLIENT connecting to this host.
   */
  hostAddr?: string;
  /**
   * Used in 'call-full' rejection: host sends this when the call has reached
   * its maximum capacity (MAX_CALL_PARTICIPANTS). The client receiving this
   * should show a notification and close the call UI.
   */
  callFull?: {
    maxParticipants: number;
    currentParticipants: number;
  };
  /**
   * Used when declining an incoming call: the invited participant tells
   * the host that they declined the call (as opposed to simply being
   * unreachable).
   */
  callDeclined?: {
    by: string;
  };
  /**
   * Sent by a client that is re-joining a group call it left earlier, at the
   * moment the user presses "Join Call" - ahead of its SDP offer, which is by
   * far the largest message in the protocol (13-21 KB against this one's
   * ~250 B) and therefore the slowest to arrive. It buys the other
   * participants ~40s of knowing that someone is on the way; nothing else
   * tells them until the offer lands.
   */
  rejoining?: {
    by: string;
  };
  /**
   * Sent inside a 'heartbeat' stage message by a peer that received WebRTC
   * signals without the preceding 'start' (lost in ASMail delivery): it asks
   * the host to re-send 'start' so the incoming-call UI can be shown.
   * `requester` is the address asking for the re-send, and `callSessionId`
   * is the session those orphaned signals belong to, so the host can refuse
   * a request about a call that is already over.
   *
   * Earlier builds sent this as a bare `true` with `requester` in the field
   * below; both forms are accepted on receipt, only the object one is sent.
   */
  requestStart?:
    | true
    | {
        requester: string;
        callSessionId?: string;
      };
  /** Only present with the legacy flat form of `requestStart`. */
  requester?: string;
  /**
   * Sent by a device to the *own* address of its user, when the user answered
   * or declined an incoming call on it. An ASMail inbox is shared by all of a
   * user's devices, so every one of them rings; without this the others keep
   * ringing until the call itself ends.
   *
   * `deviceId` is the device that handled the call, so its own copy of this
   * message (delivery to own address reaches the sender too) can be skipped.
   * A device seeing someone else's `deviceId` ends its ringing call *silently*:
   * peers are keyed by address, so anything it sent to the host would be taken
   * as coming from the device that actually joined.
   */
  callHandledElsewhere?: {
    deviceId: string;
    joined: boolean;
    /**
     * Set when the sender is already *in* the call, rather than answering it.
     *
     * Sent only in reply to another device's notice, i.e. only when two devices
     * did answer within the delivery delay of the first notice. It settles that
     * contention where the tie-break on device ids cannot: a device with media
     * running has passed a point the one still on the setup screen has not.
     * Optional, so a build that predates it simply falls back to the tie-break.
     */
    inCall?: true;
    /**
     * Set when the sender is *leaving* a group call that goes on without it,
     * rather than taking one: the hold its earlier notice put on the user's
     * other devices is over, and any of them may join now.
     *
     * A device that yielded a call keeps its "Join Call" button down for as
     * long as the call is held elsewhere (see admitsHeartbeat) - otherwise two
     * devices of one address end up in one call, which the host cannot even
     * tell apart. Nothing else would lift that hold in time: the host's
     * heartbeats say a call is on, not who of this user's devices is in it, and
     * waiting for the record to expire takes minutes.
     *
     * `joined` stays true on such a notice, so a build that predates this field
     * reads it as the ordinary "answered elsewhere" it has always read - the
     * call was indeed answered there - and behaves exactly as before.
     */
    left?: true;
  };
  /**
   * Marks a 'heartbeat' that one device of this user re-sent to the user's own
   * address, on behalf of the host whose beat it had just accepted.
   *
   * It exists because of a platform defect: an inbox subscription can go blind
   * to one correspondent while staying live for others. In the run of
   * 2026-08-16 the second device of a user received NOTHING from the host - not
   * one of the four copies of 'start', not one heartbeat - while messages from
   * its own address kept arriving normally, and a scan of the inbox found every
   * one of the missing messages sitting there. So the "Join Call" button never
   * appeared on it. Sending to one's own address is the one path that demonstrably
   * still works in that state, and it is the same path callHandledElsewhere
   * already uses.
   *
   * `byDeviceId` is the relaying device: its own copy of the message (delivery
   * to one's own address comes back to the sender) is recognized by it and
   * ignored, and a relayed beat is NEVER relayed on - that pair is the whole
   * loop protection.
   */
  relayedRejoin?: {
    byDeviceId: string;
  };
  /**
   * 'start' only: when the host first sent the invitation, by its own clock.
   *
   * The tie-break between two calls started in one chat at the same moment
   * (see callCollisionWinner in call-state.ts) compares these, and it cannot use
   * `WebRTCMsg.id` instead: every copy of 'start' is stamped afresh, so the
   * repeats of the earlier call would look later than they are. Optional: a
   * 'start' without it comes from a build that cannot step aside in a
   * collision, and the tie-break lets such a call win.
   */
  startedAt?: number;
  /**
   * "I am calling in this chat too" - sent by a host to the host of another
   * call in the same chat, as soon as it learns of that call, so that both run
   * the same tie-break on the same facts. The session id is the sender's own,
   * in `WebRTCMsg.callSessionId`.
   *
   * `established` is what only the sender knows: someone has already answered
   * its call. Such a call is never the one to give way.
   */
  callCollision?: {
    startedAt?: number;
    established: boolean;
  };
  /**
   * 'disconnect' only: the host withdraws its call because another call in the
   * same chat, started at the same moment, won the tie-break. An invitee still
   * ringing for the withdrawn call rings for this one instead, without waiting
   * for a repeat of its 'start' - the first copy may well have been refused
   * while the withdrawn call was ringing.
   */
  supersededBy?: {
    hostAddr: string;
    callSessionId?: string;
    startedAt?: number;
  };
}

export interface ChatIncomingMessage extends web3n.asmail.IncomingMessage {
  msgType: 'chat';
  jsonBody: ChatMessageJsonBody;
}

export interface ChatOutgoingMessage extends web3n.asmail.OutgoingMessage {
  msgType: 'chat';
  jsonBody: ChatMessageJsonBody;
}

/**
 * ChatIdObj contains flag to indicate whether this is a group chat, or a
 * one-to-one chat.
 * In one-to-one chat, internal chatId field is peer's canonical address
 * (otoPeerCAddr).
 * In group chat, internal chatId field is a random string that should be
 * unique for all members. Ensuring of uniqueness needs longer id, and
 * potential renegotiation process.
 */
export interface ChatIdObj {
  isGroupChat: boolean;

  /**
   * chatId of a one-to-one chat is peer's canonical address (otoPeerCAddr).
   * chatId of a group chat is a random string that should be
   * unique for all members. Ensuring of uniqueness needs longer id, and
   * potential renegotiation process.
   */
  chatId: string;
}

export interface ChatMessageId {
  chatId: ChatIdObj;
  chatMessageId: string;
}
