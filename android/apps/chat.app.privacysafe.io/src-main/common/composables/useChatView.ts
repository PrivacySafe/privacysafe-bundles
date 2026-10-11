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
import { computed, inject, nextTick, provide, ref, toRaw, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
  RouteLocationNormalizedLoadedGeneric,
  Router,
} from 'vue-router';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import get from 'lodash/get';
import size from 'lodash/size';
import isEmpty from 'lodash/isEmpty';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { capitalize, formatFileSize, getFileExtension } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import {
  ChatIdObj,
  ChatMessageAttachmentsInfo,
  ChatMessageId,
  ChatMessageView,
  GroupChatView,
  OutgoingAttachment,
  RegularMsgView,
  RelatedMessage,
  Ui3nTextEnterEvent,
} from '~/index';
import type { ChatRoute, ChatRouteType, ChatWithFwdMsgRef, ChatWithIncomingCall } from '@main/desktop/router';
import type { RouteChat } from '@main/mobile/types';
import { fileLinkStoreSrv } from '@main/common/services/external-services';
import { useTaskRunner } from '@main/common/composables/useTaskRunner';
import { THUMBNAIL_CACHE_KEY, useThumbnailCache } from '@main/common/composables/useThumbnailCache';
import { CHAT_STAGE_KEY, useChatStage } from '@main/common/composables/useChatStage';
import { RECORDING_PLAYBACK_KEY, useRecordingPlayback } from '@main/common/composables/useRecordingPlayback';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { areChatIdsEqual } from '@shared/chat-ids';
import { toCanonicalAddress } from '@shared/address-utils';
import { MAX_ATTACHMENT_SIZE } from '@shared/constants/attachment-limits';
import {
  prepareAttachmentEntityInfo,
  prepareMessageBody,
  restoreRawMessage,
} from '@main/common/utils/chats.helper';
import { chatBlockingStateOf, recordingExcerpt, recordingOfAttachments } from '@main/common/utils/chat-ui.helper';
import MessageDeleteDialog from '@main/common/components/dialogs/message-delete-dialog.vue';
import ChatMediaRecorderDialog from '@main/common/components/dialogs/chat-media-recorder/chat-media-recorder-dialog.vue';
import type { MediaRecordingResult } from '@main/common/components/dialogs/chat-media-recorder/useMediaRecorder';
import { nameForRecording } from '@shared/media-recording-format';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatView');

/**
 * How close to an edge of the message list counts as being at it: for the bottom
 * it decides whether the "scroll down" button is shown, for the top it triggers
 * loading of the previous page.
 */
const LIST_EDGE_THRESHOLD_PX = 64;

/**
 * How old an incoming-call command may be and still arm the incoming-call UI.
 * Well under the background service's RINGING_NO_ANSWER_TIMEOUT_MILLIS: a
 * command older than this is a re-delivery (window re-creation), not a call
 * that is still ringing.
 */
const INCOMING_CALL_CMD_MAX_AGE_MILLIS = 60_000;

function packRelatedMessageToSend(msg: ChatMessageView, relationType: 'reply' | 'forward'): RelatedMessage {
  switch (relationType) {
    case 'reply': {
      return {
        replyTo: {
          chatMessageId: msg.chatMessageId,
        },
      };
    }

    default:
      throw new Error(`Unknown relation type: ${relationType}`);
  }
}

interface NavigationUtils {
  route: RouteLocationNormalizedLoadedGeneric;
  router: Router;
  getChatIdFromRoute: (params?: ChatRoute['params'] | RouteChat['params']) => ChatIdObj | undefined;
  getForwardedMsgIdFromRoute: (
    query?: ChatWithFwdMsgRef['query'] | RouteChat['query'],
  ) => ChatMessageId | undefined;
  getIncomingCallParamsFromRoute: (route: ChatWithIncomingCall | RouteChat) =>
    | {
        chatId: ChatIdObj;
        peerAddress: string;
        callSessionId?: string;
        callSentAt?: number;
      }
    | undefined;
}

export function useChatView(navigationUtils: () => NavigationUtils) {
  const { addTask, cancelTasks } = useTaskRunner();
  provide('task-runner', { addTask });
  // Handed out here so that it lives exactly as long as this view: on a change
  // of chat the map goes with it, and the previous chat's previews cannot show
  // up in the next one.
  provide(THUMBNAIL_CACHE_KEY, useThumbnailCache());
  // The same reasoning for both of these: one recording of the open chat plays
  // at a time, and a video message is shown over the area of this view.
  const recordingPlayback = useRecordingPlayback();
  provide(RECORDING_PLAYBACK_KEY, recordingPlayback);
  const chatStage = useChatStage();
  provide(CHAT_STAGE_KEY, chatStage);

  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  const { route, router, getChatIdFromRoute, getForwardedMsgIdFromRoute, getIncomingCallParamsFromRoute } =
    navigationUtils();

  const { user, appWindowSize, isMobileMode } = storeToRefs(useAppStore());

  const contactsStore = useContactsStore();
  const { isBlacklisted } = contactsStore;

  const chatsStore = useChatsStore();
  const { updateChatItemInList } = chatsStore;

  const chatStore = useChatStore();
  const { currentChat, currentChatId } = storeToRefs(chatStore);
  const { setChatAndFetchMessages, sendMessageInChat, updateEarlySentMessage } = chatStore;

  const messagesStore = useMessagesStore();
  const { currentChatMessages, selectedMessages, hasMoreOlder, isFetchingOlder } = storeToRefs(messagesStore);
  const { getChatMessage, clearSelectedMessages, deleteMessagesInChat, fetchOlderMessages } = messagesStore;

  const files = ref<OutgoingAttachment[]>([]);
  /**
   * Storage items made for pasted files that are not part of a sent message
   * yet, and are therefore this composer's to remove. Emptied when a message
   * takes them over, so that a send followed by leaving the chat cannot delete
   * the attachments of the message just sent.
   */
  const ownedStoredIds = new Set<string>();

  const inputEl = ref<Nullable<HTMLTextAreaElement>>(null);
  const msgText = ref<string>('');
  const disabled = ref(false);
  const attachmentsInfo = ref<ChatMessageAttachmentsInfo[] | undefined>(undefined);
  const initialMessage = ref<Nullable<RegularMsgView>>(null);
  const initialMessageType = ref<'reply' | 'forward'>('reply');
  const editableMessage = ref<Nullable<RegularMsgView>>(null);
  const isEmoticonsDialogOpen = ref(false);

  const msgInfoDisplayed = ref<Nullable<RegularMsgView>>(null);

  const messageListElement = ref<Nullable<HTMLDivElement>>(null);
  const messageListElementRect = ref<DOMRect | undefined>(undefined);
  const whetherShowButtonDown = ref(false);

  const mention = ref<{ startIndex: number; member: Nullable<string> }>({
    startIndex: -1,
    member: null,
  });
  const activeSuggestionIndex = ref(-1);
  const filteredMembers = computed(() =>
    currentChat.value && (currentChat.value as GroupChatView).members
      ? Object.keys((currentChat.value as GroupChatView).members).filter(addr => {
          if (mention.value.member === null) {
            return false;
          }

          const mail = toCanonicalAddress(addr.toLowerCase());
          return mail !== user.value && mail.includes(mention.value.member.toLowerCase());
        })
      : [],
  );
  const blockingState = computed(() =>
    currentChat.value
      ? chatBlockingStateOf(currentChat.value, isBlacklisted, user.value)
      : { blockedMembers: [], allOthersBlocked: false },
  );
  const blockedMembers = computed(() => blockingState.value.blockedMembers);

  watch(
    () => size(filteredMembers.value),
    val => {
      setTimeout(() => {
        if (val > 0) {
          activeSuggestionIndex.value = -1;
        }
      }, 100);
    },
    {
      immediate: true,
    },
  );

  const attachmentsTotal = computed(() => {
    if (isEmpty(attachmentsInfo.value)) {
      return 0;
    }

    return (attachmentsInfo.value || []).reduce((acc, item) => {
      acc += item.size;
      return acc;
    }, 0);
  });

  const readonly = computed(() => {
    if (!currentChat.value) {
      return true;
    }

    if (['initiated', 'invited', 'no-members'].includes(currentChat.value.status)) {
      return true;
    }

    if (currentChat.value.isGroupChat && !get(currentChat.value, ['members', user.value, 'hasAccepted'])) {
      return true;
    }

    // Nobody left to write to: the peer of a one-to-one chat is blocked, or
    // every other member of a group is. A group with only some of them blocked
    // stays writable - those are simply struck off the recipients when sending.
    return blockingState.value.allOthersBlocked;
  });

  const sendBtnDisabled = computed<boolean>(() => {
    return !(msgText.value.trim() || attachmentsInfo.value) || disabled.value || readonly.value;
  });

  /**
   * Whether a recording can be started right now.
   *
   * A call in this chat holds the microphone and the camera in the call window,
   * so a recording started here would fail with NotReadableError - refused
   * before it is attempted rather than explained afterwards. Nothing here has
   * to guard the "one recording per message" invariant the wire format relies
   * on: a recording is a message of its own, carrying one attachment.
   */
  const recordBtnDisabled = computed<boolean>(
    () => disabled.value || readonly.value || !!currentChat.value?.isCallActive,
  );

  function hideSuggestions() {
    mention.value = {
      startIndex: -1,
      member: null,
    };
    activeSuggestionIndex.value = -1;
  }

  function recognizeMention(text: string) {
    const cursorPosition = inputEl.value!.selectionStart;
    const lastAtSymbolIndex = text.lastIndexOf('@', cursorPosition - 1);
    if (lastAtSymbolIndex !== -1 && (lastAtSymbolIndex === 0 || /\s/.test(text[lastAtSymbolIndex - 1]))) {
      mention.value.startIndex = lastAtSymbolIndex + 1;
      mention.value.member = text.substring(lastAtSymbolIndex + 1, cursorPosition);
    }
  }

  function onInput(text: string) {
    if (currentChat.value?.isGroupChat) {
      recognizeMention(text);
    }
  }

  function getCharFromTheLeft(event: KeyboardEvent) {
    const target = event.target as HTMLTextAreaElement;
    const cursorPosition = target.selectionStart;
    if (cursorPosition !== null && cursorPosition > 0) {
      const text = target.value;
      return text[cursorPosition - 1];
    }

    return '';
  }

  function onKeydown(event: KeyboardEvent) {
    const { key } = event;
    switch (key) {
      case 'ArrowUp': {
        const char = getCharFromTheLeft(event);
        if (char !== '@') {
          return;
        }

        event.preventDefault();
        const possibleSuggestionIndex = activeSuggestionIndex.value - 1;
        activeSuggestionIndex.value =
          possibleSuggestionIndex === -1 ? size(filteredMembers.value) - 1 : possibleSuggestionIndex;
        break;
      }
      case 'ArrowDown': {
        const char = getCharFromTheLeft(event);
        if (char !== '@') {
          return;
        }

        event.preventDefault();
        const possibleSuggestionIndex = activeSuggestionIndex.value + 1;
        activeSuggestionIndex.value =
          possibleSuggestionIndex === size(filteredMembers.value) ? 0 : possibleSuggestionIndex;
        break;
      }
      default:
    }
  }

  function onEscape(event: Event) {
    event.preventDefault();
    if (initialMessage.value !== null) {
      return clearInitialInfo();
    }

    if (editableMessage.value !== null) {
      return finishEditMsgMode();
    }

    // TODO ??? Perhaps it's also worth handling the situation when a user enters a mention of another address in
    //  the text.
    // TODO ??? It might also be worthwhile to handle the situation when attachments are attached to a message.
  }

  function selectMention(index: number) {
    const member = filteredMembers.value[index];
    const parsedMember = member.split('@');
    const currentMention = `${parsedMember[0]}[${parsedMember[1]}]`;
    const newMsgText =
      msgText.value.slice(0, mention.value.startIndex) +
      currentMention +
      msgText.value.slice(mention.value.startIndex + 1) +
      ' ';
    msgText.value = newMsgText;

    activeSuggestionIndex.value = -1;
    mention.value = {
      startIndex: -1,
      member: null,
    };
    inputEl.value?.focus();
  }

  function setMessageListElementRect(el: Nullable<HTMLDivElement>) {
    messageListElementRect.value = el ? el.getBoundingClientRect() : undefined;
  }

  /**
   * The list element is replaced whenever chat-messages is remounted, so the
   * listener comes off the old one before it goes onto the new: without that,
   * every remount left one more subscription on a detached element, all of them
   * still firing into this composable.
   */
  function onMessageListElementInit(value: Nullable<HTMLDivElement>) {
    messageListElement.value?.removeEventListener('scroll', onMessageListScroll);
    messageListElement.value = value;
    setMessageListElementRect(value);
    value?.addEventListener('scroll', onMessageListScroll);
  }

  /**
   * Read into locals and give up when there is no list yet.
   *
   * Not only a scroll handler: the watcher on window height below calls this
   * too, and that watcher runs from the moment the chat route is rendered -
   * while chat-messages waits behind `v-if` for its messages to arrive. The
   * first resize callback of a window opened on a chat route therefore lands on
   * an empty ref, and on 2026-09-11 that was the TypeError in the console of a
   * window whose background component had stopped answering, so the list was
   * never going to arrive at all.
   */
  function onMessageListScroll() {
    const el = messageListElement.value;
    const rect = messageListElementRect.value;
    if (!el || !rect) {
      return;
    }

    whetherShowButtonDown.value = el.scrollHeight - LIST_EDGE_THRESHOLD_PX > rect.height + el.scrollTop;

    if (el.scrollTop <= LIST_EDGE_THRESHOLD_PX) {
      void loadOlderMessagesKeepingPosition();
    }
  }

  /**
   * Adds the previous page at the top of the list without moving what the user
   * is looking at: prepending pushes the content down by exactly the height it
   * adds, so the same amount goes back into the scroll position.
   */
  async function loadOlderMessagesKeepingPosition(): Promise<void> {
    const el = messageListElement.value;
    if (!el || !hasMoreOlder.value || isFetchingOlder.value) {
      return;
    }

    const heightBefore = el.scrollHeight;
    await fetchOlderMessages();
    await nextTick();
    el.scrollTop += el.scrollHeight - heightBefore;
  }

  function scrollMessageListToEnd() {
    messageListElement.value && (messageListElement.value.scrollTop = 1e12);
  }

  function setMsgForWhichInfoIsDisplayed(value: Nullable<RegularMsgView>) {
    msgInfoDisplayed.value = value;
  }

  async function deleteMessages() {
    if (!selectedMessages.value.length) {
      return;
    }

    const res = await dialog.$openDialog<boolean>(MessageDeleteDialog, {
      text: t('chat.messages.bulk.delete'),
      dialogProps: {
        title: t('chat.messages.bulk.delete'),
        ...(isMobileMode.value && { width: 300 }),
        confirmButtonText: capitalize(t('app.text.delete')),
        confirmButtonColor: 'var(--color-text-button-secondary-default)',
        confirmButtonBackground: 'var(--color-bg-button-secondary-default)',
        cancelButtonColor: 'var(--color-text-button-primary-default)',
        cancelButtonBackground: 'var(--color-bg-button-primary-default)',
      },
    });

    const { event, data } = res;
    if (event === 'confirm' && currentChatId.value) {
      deleteMessagesInChat(selectedMessages.value, data);
      clearSelectedMessages();
    }
  }

  /**
   * The recording the message being replied to or forwarded consists of, so
   * that the banner can show a frame of it rather than a line of text. Beside
   * getTextOfEditableOrInitialMsg rather than inside it: that one answers with
   * HTML, and a preview has to be read from the previews table.
   */
  const initialMsgRecording = computed(() =>
    initialMessage.value && !initialMessage.value.body
      ? recordingOfAttachments(initialMessage.value.attachments)
      : undefined,
  );

  function getTextOfEditableOrInitialMsg(msg: Nullable<RegularMsgView>) {
    if (!msg) {
      return '';
    }

    const { body, attachments } = msg;
    // A recording being replied to or forwarded reads as what it is, rather
    // than as the generated name it was attached under.
    const recording = recordingOfAttachments(attachments);
    if (!body && recording) {
      return `<i>${recordingExcerpt(recording, t)}</i>`;
    }
    const attachmentsText = (attachments || []).map(a => a.name).join(', ');
    return body || `<i>${t('app.text.receive.file')}: ${attachmentsText}</i>`;
  }

  function onEmoticonSelect(emoticon: { id: string; value: string }) {
    msgText.value += emoticon.value;
  }

  async function prepareInfoFromForwardedMessage(fwdMsgId: ChatMessageId) {
    const msg = await getChatMessage(fwdMsgId);
    if (msg && msg.chatMessageType === 'regular') {
      initialMessageType.value = 'forward';
      initialMessage.value = msg;
      inputEl.value?.focus();
    }
  }

  /**
   * Adds one picked entity to the composer, or says why it cannot be added.
   *
   * Shared by every way of attaching - the dialog, drag-and-drop and paste -
   * so that the size limit and the error reporting hold for all of them, and
   * so that one unattachable file does not lose the others picked with it.
   */
  async function attachEntity(attachment: OutgoingAttachment): Promise<boolean> {
    const { entity, name } = attachment;
    const fileName = name ?? entity.name;
    try {
      // Folders are not size-checked here: their size is only known after a
      // full walk of the tree, which is not a price to pay on every drop. The
      // tile computes it for display, and sending decides on a walk bounded by
      // the copying threshold.
      const isFolder = !!(entity as web3n.files.ReadonlyFS).listFolder;
      if (!isFolder) {
        const { size = 0 } = await (entity as web3n.files.ReadonlyFile).stat();
        if (size > MAX_ATTACHMENT_SIZE) {
          notifications?.$createNotice({
            type: 'error',
            content: t('chat.attachment.too_big.error', {
              fileName,
              limit: formatFileSize(MAX_ATTACHMENT_SIZE),
            }),
          });
          return false;
        }
      }

      const attachmentInfo = await prepareAttachmentEntityInfo(entity, name);
      if (!attachmentInfo) {
        return false;
      }

      files.value.push(attachment);
      attachmentsInfo.value!.push(attachmentInfo);
      return true;
    } catch (e) {
      log.error(`Error attaching the file '${fileName}'.`, e);

      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.attaching.error', { fileName }),
      });
      return false;
    }
  }

  async function addFiles(): Promise<void> {
    // The button that calls this is disabled in a readonly chat, but a guard
    // here as well - the other two ways of attaching (drag-and-drop and paste)
    // have had one from the start, and a disabled button is a statement about
    // the markup, not about what may be attached.
    if (readonly.value) {
      return;
    }

    if (isEmpty(attachmentsInfo.value)) {
      attachmentsInfo.value = [];
    }

    const newFiles = await w3n.shell?.fileDialogs?.openFileDialog!(
      t('chat.attachment.dialog.title'),
      t('chat.attachment.dialog.btn.select'),
      true,
    );
    if (!newFiles) {
      return;
    }

    for (const f of newFiles) {
      await attachEntity({ entity: f });
    }

    inputEl.value && inputEl.value.focus();
  }

  /**
   * Name for a screenshot pasted from the clipboard, which arrives as plain
   * `image.png` and would otherwise reach the recipient under that name - or,
   * before the stored item's own name stopped being used, as `image-x7q.png`.
   *
   * Dashes in the time rather than colons: a colon cannot be part of a file
   * name on Windows, and the recipient saving the attachment there would hit
   * exactly that.
   */
  function nameOfPastedFile(f: File): string {
    if (!f.type.startsWith('image/')) {
      return f.name;
    }

    // The pasted name is where the extension comes from first: a clipboard
    // image arrives as `image.png`, and its media type can be something like
    // `image/svg+xml`, whose subtype is no extension at all.
    const ext = getFileExtension(f.name) || f.type.slice('image/'.length).replace(/[^a-z0-9]/gi, '');
    return `screenshot_${dayjs().format('YY-MM-DD_HH-mm-ss')}${ext ? `.${ext}` : ''}`;
  }

  /**
   * A clipboard file has no existence outside this app, so it has to be written
   * into the app's storage before it can be attached at all. The id of what was
   * written travels with it: sending then takes that item over as the message's
   * attachment instead of storing the same bytes a second time.
   */
  async function fileTo3nFile(f: File): Promise<OutgoingAttachment | undefined> {
    const name = nameOfPastedFile(f);
    // Checked before the bytes are written, not after: there is no point in
    // filling the storage with a file that is about to be refused.
    if (f.size > MAX_ATTACHMENT_SIZE) {
      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.too_big.error', {
          fileName: name,
          limit: formatFileSize(MAX_ATTACHMENT_SIZE),
        }),
      });
      return;
    }

    const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const content = e.target?.result;
        content ? resolve(content as ArrayBuffer) : reject(new Error(`No content read from ${f.name}`));
      };
      reader.onerror = e => reject(e);
      reader.readAsArrayBuffer(f);
    });

    const storedId = await fileLinkStoreSrv.saveFile(fileContent, name);
    ownedStoredIds.add(storedId);
    const entity = (await fileLinkStoreSrv.getFile(storedId)) as web3n.files.ReadonlyFile | null | undefined;
    if (!entity) {
      await discardOwnedStoredItems([storedId]);
      return;
    }
    return { entity, storedId, name };
  }

  async function addFilesViaDnD(fileList: FileList): Promise<void> {
    if (readonly.value) {
      return;
    }

    if (isEmpty(attachmentsInfo.value)) {
      attachmentsInfo.value = [];
    }
    // @ts-ignore
    for (const f of [...fileList]) {
      let attachment: OutgoingAttachment | undefined;

      try {
        const fStats = await w3n.shell!.deviceFiles?.statStandardItem(f);

        const entity = fStats!.isFolder
          ? await w3n.shell!.deviceFiles?.standardFileToDeviceFolder!(f)
          : await w3n.shell!.deviceFiles?.standardFileToDeviceFile!(f);
        attachment = entity ? { entity } : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.type === 'file' && e.isInMemoryFile) {
          try {
            attachment = await fileTo3nFile(f);
          } catch (err) {
            log.error(`Error storing the pasted file '${f.name}'.`, err);
            notifications?.$createNotice({
              type: 'error',
              content: t('chat.attachment.attaching.error', { fileName: f.name }),
            });
          }
        } else {
          log.error('Error reading file. ', e);
        }
      }

      if (attachment) {
        const added = await attachEntity(attachment);
        if (!added && attachment.storedId) {
          await discardOwnedStoredItems([attachment.storedId]);
        }
      }
    }

    inputEl.value && inputEl.value.focus();
  }

  async function addFilesViaPaste(ev: ClipboardEvent): Promise<void> {
    if (size(ev.clipboardData?.files) > 0) {
      const currentMsgText = msgText.value;
      await addFilesViaDnD(ev.clipboardData!.files);
      inputEl.value && inputEl.value.select();
      const selection = window.getSelection();
      if (selection) {
        selection.deleteFromDocument();
        msgText.value = currentMsgText;
      }
    }
  }

  /**
   * Removes the storage items this composer still owns.
   *
   * Only a pasted file leaves an item behind before the message is sent, and
   * until it is sent nothing else in the app knows of it - so dropping such an
   * attachment, or walking away from the composer, has to take the item with
   * it. Once the message is on its way the item belongs to the message, and
   * deleting it is the business of deleting that message.
   */
  async function discardOwnedStoredItems(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (!ownedStoredIds.has(id)) {
        continue;
      }
      ownedStoredIds.delete(id);
      try {
        await fileLinkStoreSrv.deleteEntity(id);
      } catch (e) {
        log.error(`Error removing the stored item ${id} of an unsent attachment.`, e);
      }
    }
  }

  async function deleteAttachment(index: number) {
    const removed = files.value ? files.value.splice(index, 1) : [];
    attachmentsInfo.value && attachmentsInfo.value.splice(index, 1);
    if (size(attachmentsInfo.value) === 0) {
      attachmentsInfo.value = undefined;
    }

    await discardOwnedStoredItems(removed.map(a => a.storedId!).filter(Boolean));
  }

  async function clearAttachments() {
    const removed = files.value.map(a => a.storedId!).filter(Boolean);
    files.value = [];
    attachmentsInfo.value = undefined;

    await discardOwnedStoredItems(removed);
  }

  function clearInitialInfo() {
    initialMessage.value = null;
  }

  function finishEditMsgMode() {
    editableMessage.value = null;
    msgText.value = '';
  }

  function prepareReplyMessage(msg: RegularMsgView) {
    initialMessageType.value = 'reply';
    initialMessage.value = msg;
    inputEl.value?.focus();
  }

  function startEditMsgMode(msg: RegularMsgView) {
    editableMessage.value = msg;
    editableMessage.value.body = restoreRawMessage(msg.body);

    msgText.value = restoreRawMessage(msg.body);
    inputEl.value?.focus();
  }

  function isMsgEmpty() {
    if (!(msgText.value || size(files) > 0)) {
      return true;
    }

    if (size(files.value) > 0) {
      return false;
    }

    if (msgText.value === '\n') {
      msgText.value = '';
      return true;
    }

    return false;
  }

  /**
   * Opens the recorder and, if something was recorded and approved, sends it.
   *
   * A recording goes out as a message of its own, with no text: that is what a
   * voice message is, and the composer is left exactly as it was - whatever is
   * typed or attached there is still waiting to be sent. What keeps this from
   * being an irreversible send on the release of a button is the recorder's own
   * review step: nothing reaches here until the user has heard the recording
   * and asked for it to be sent.
   */
  async function openMediaRecorder(): Promise<void> {
    if (recordBtnDisabled.value) {
      return;
    }

    const answer = await dialog?.$openDialog<MediaRecordingResult>(ChatMediaRecorderDialog, {
      dialogProps: {
        icon: 'outline-voice-chat',
        title: t('chat.recording.dialogTitle'),
        cssStyle: { width: '520px', maxWidth: '95%' },
        confirmButton: false,
        cancelButton: false,
        // A stray click outside must not throw a recording away, and ESC is
        // handled inside the dialog, where it can stop the device first.
        closeOnClickOverlay: false,
        closeOnEsc: false,
      },
    });

    // `data` is only set when the dialog closed with a recording the user asked
    // to send; every other way out of it - cancelled, re-recorded, or a device
    // that would not start - leaves it undefined, and has already said so where
    // it happened.
    if (answer?.data) {
      await sendRecordingAsMessage(answer.data);
    }
  }

  /**
   * Sends a recording as a message of its own, carrying nothing but itself.
   *
   * The bytes go through the same storage item a pasted file does, for the same
   * reason: a recording has no existence outside this app. What differs from
   * sendMessage() is what is *not* done - the composer's text, attachments,
   * reply and edit modes are all left alone, because none of them is part of
   * this message.
   */
  async function sendRecordingAsMessage(recorded: MediaRecordingResult): Promise<void> {
    const { blob, mimeType, ext, kind, durationMs, preview } = recorded;
    const chatId = currentChatId.value;
    if (!chatId) {
      return;
    }

    const name = nameForRecording(kind, dayjs().format('YY-MM-DD_HH-mm-ss'), ext);

    let attachment: OutgoingAttachment | undefined;
    try {
      attachment = await fileTo3nFile(new File([blob], name, { type: mimeType }));
    } catch (e) {
      log.error(`Error storing the recording '${name}'.`, e);
      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.attaching.error', { fileName: name }),
      });
      return;
    }
    if (!attachment) {
      return;
    }

    attachment.recording = { kind, durationMs, ...(preview && { preview }) };
    const storedId = attachment.storedId!;

    // Not awaited, and the stored item is not discarded if it fails: the
    // message record is written before the delivery is queued, so removing the
    // item after a late failure would gut a message that exists.
    sendMessageInChat({
      chatId: toRaw(chatId),
      text: '',
      files: [attachment],
      // A recording is never a reply: a reply is a text message, and the reply
      // armed in the composer is still armed for it.
      relatedMessage: undefined,
    }).catch(e => {
      log.error('Error sending the recording.', e);
      notifications?.$createNotice({ type: 'error', content: t('chat.recording.error.sending') });
    });

    // This one item is handed over, and only it. sendMessage()'s blanket
    // ownedStoredIds.clear() would hand over the pasted attachments waiting in
    // the composer as well, and leaving the chat would then leak them.
    ownedStoredIds.delete(storedId);

    inputEl.value && inputEl.value.focus();
  }

  async function sendMessage(ev?: Ui3nTextEnterEvent, force = false) {
    if (disabled.value || readonly.value || isMsgEmpty()) {
      return;
    }

    if (!isEmpty(filteredMembers.value)) {
      if (activeSuggestionIndex.value >= 0) {
        selectMention(activeSuggestionIndex.value);
        setTimeout(() => {
          const lastCharCode = msgText.value.charCodeAt(msgText.value.length - 1);
          lastCharCode === 10 && (msgText.value = msgText.value.slice(0, -1));
        }, 50);
      }
      return;
    }

    const { shiftKey } = ev ?? { shiftKey: false };

    if (force || (!force && !shiftKey)) {
      if (editableMessage.value && JSON.stringify(editableMessage.value!.body) !== JSON.stringify(msgText.value)) {
        disabled.value = true;

        updateEarlySentMessage({
          chatId: currentChatId.value!,
          chatMessageId: editableMessage.value!.chatMessageId,
          updatedBody: msgText.value ? prepareMessageBody(msgText.value) : '',
        });

        setTimeout(() => {
          msgText.value = '';
          files.value = [];
          attachmentsInfo.value = undefined;
          initialMessage.value = null;
          editableMessage.value = null;
          disabled.value = false;
        }, 400);

        return;
      }

      const relatedMessage = initialMessage.value
        ? packRelatedMessageToSend(initialMessage.value, initialMessageType.value)
        : undefined;
      disabled.value = true;

      msgText.value = msgText.value ? prepareMessageBody(msgText.value) : '';

      sendMessageInChat({
        chatId: toRaw(currentChatId.value!),
        text: (msgText.value || '').trim(),
        files: toRaw(files.value),
        relatedMessage,
      }).catch(e => log.error('Error sending the message.', e));

      // The message owns its attachments from here on: the call above has
      // already taken them, and this composer must not delete their storage
      // items when it is closed.
      ownedStoredIds.clear();

      setTimeout(() => {
        msgText.value = '';
        files.value = [];
        attachmentsInfo.value = undefined;
        initialMessage.value = null;
        editableMessage.value = null;
        disabled.value = false;
      }, 400);
    }
  }

  async function setStateFollowingRouteQuery(query?: ChatWithFwdMsgRef['query']) {
    const fwdMsgId = getForwardedMsgIdFromRoute(query);
    if (fwdMsgId) {
      await prepareInfoFromForwardedMessage(fwdMsgId);
    }
  }

  const routeQueryWatching = watch(
    () => route.query.call,
    async value => {
      if (value === 'yes') {
        const { chatId, peerAddress, callSessionId, callSentAt } = getIncomingCallParamsFromRoute(
          route as unknown as ChatWithIncomingCall,
        )!;
        // An incoming-call command can reach this window long after it was
        // issued: getStartedCmd() re-delivers the starting command when the
        // window is re-created. Arming the UI from a stale one puts up a Join
        // button for a call that is over, so age gates it here - the command
        // now says when it was sent.
        if (callSentAt && Date.now() - callSentAt > INCOMING_CALL_CMD_MAX_AGE_MILLIS) {
          log.info(
            `Ignoring stale incoming-call command for chat ${chatId.chatId} from ` +
              `${peerAddress} (age: ${Date.now() - callSentAt}ms)`,
          );
          nextTick(() => {
            router.replace({ query: {} });
          });
          return;
        }
        const armed = await updateChatItemInList(chatId, {
          incomingCall: { chatId, peerAddress, callSessionId },
        });
        // The last link of the incoming-call chain: the background service asked
        // the shell for the incoming-call UI, the command routed here, and
        // `incomingCall` is what drives both the Join/Decline buttons and the
        // ringtone. Logged at `info` (this window never turns diagnostics on), so
        // that "it only rang on one device" can be pinned on either the signal
        // or the UI, and not left between them. The outcome is reported, not
        // assumed: the chat may not be in this window's list at all, and a line
        // claiming success there would send the next diagnosis the wrong way.
        log.info(
          armed
            ? `Incoming-call UI armed for chat ${chatId.chatId} from ${peerAddress}`
            : `Incoming-call UI NOT armed for chat ${chatId.chatId} from ${peerAddress}: ` +
                `the chat is not in this window's list`,
        );
        nextTick(() => {
          router.replace({ query: {} });
        });
      }
    },
    { immediate: true },
  );

  function scrollToFirstUnreadMessage() {
    const unread = currentChat.value?.unread || 0;
    if (unread === 0) {
      const chatMessageListElement = document.getElementById('chat-messages');
      chatMessageListElement && (chatMessageListElement.scrollTop = 1e12);
      return;
    }

    const incomingMessages = currentChatMessages.value
      .filter(msg => msg.isIncomingMsg && msg.chatMessageType === 'regular')
      .sort((aMsg, bMsg) => bMsg.timestamp - aMsg.timestamp);

    const unreadMessages = incomingMessages.slice(0, unread);
    const firstUnreadMessage = unreadMessages[unread - 1];
    if (!firstUnreadMessage) {
      return;
    }

    const firstUnreadMessageEl = document.getElementById(`msg-${firstUnreadMessage.chatMessageId}`);
    if (!firstUnreadMessageEl) {
      return;
    }

    nextTick(() => {
      firstUnreadMessageEl.scrollIntoView(false);
    });
  }

  watch(
    () => appWindowSize.value.height,
    (val, oldVal) => {
      if (val && val !== oldVal) {
        setMessageListElementRect(messageListElement.value);
        onMessageListScroll();
      }
    },
  );

  async function doAfterMount() {
    const chatId = getChatIdFromRoute();

    if (chatId) {
      await setChatAndFetchMessages(chatId);
      await setStateFollowingRouteQuery();
    }

    scrollToFirstUnreadMessage();

    if (currentChatId.value?.isGroupChat && inputEl.value) {
      inputEl.value.addEventListener('keydown', onKeydown);
    }
  }

  function doBeforeUnMount() {
    // Before anything else: an unmounted media element is not a stopped one.
    recordingPlayback.stopCurrent();
    routeQueryWatching.stop();
    // Optional: a chat left before its messages arrived never mounted the list,
    // and unmounting must not throw on the way out of a chat that showed none.
    messageListElement.value?.removeEventListener('scroll', onMessageListScroll);

    // Not awaited: unmounting cannot wait on storage, and there is nothing to
    // do with the outcome besides logging it, which the call itself does.
    discardOwnedStoredItems([...ownedStoredIds]);

    if (currentChatId.value?.isGroupChat && inputEl.value) {
      inputEl.value.removeEventListener('keydown', onKeydown);
    }
  }

  /**
   * Takes no `next`: the callback form is deprecated, and a guard that returns
   * nothing lets the navigation through - which is all this one ever did with
   * it.
   */
  async function doBeforeRouteUpdate(to: RouteLocationNormalized, from: RouteLocationNormalizedLoaded) {
    const chatIdFrom = getChatIdFromRoute(from.params as ChatRouteType['params']);
    const chatIdTo = getChatIdFromRoute(to.params as ChatRouteType['params']);

    if (chatIdTo && !areChatIdsEqual(chatIdFrom, chatIdTo)) {
      // The bubbles of this chat are about to be replaced, and taking a playing
      // element out of the DOM does not silence it.
      recordingPlayback.stopCurrent();
      cancelTasks();
      clearSelectedMessages();
      await setChatAndFetchMessages(chatIdTo);
      await setStateFollowingRouteQuery(to.query as ChatWithFwdMsgRef['query']);
      msgText.value = '';

      scrollToFirstUnreadMessage();
      onMessageListScroll();
      setMsgForWhichInfoIsDisplayed(null);
    }
  }

  return {
    t,
    currentChat,
    currentChatMessages,
    selectedMessages,
    messageListElement,
    whetherShowButtonDown,
    msgInfoDisplayed,
    disabled,
    readonly,
    isEmoticonsDialogOpen,
    msgText,
    inputEl,
    initialMessage,
    initialMessageType,
    initialMsgRecording,
    editableMessage,
    files,
    attachmentsInfo,
    attachmentsTotal,
    sendBtnDisabled,
    recordBtnDisabled,
    mention,
    filteredMembers,
    activeSuggestionIndex,
    blockedMembers,
    blockingState,
    clearSelectedMessages,
    deleteMessages,
    onInput,
    onKeydown,
    onEscape,
    selectMention,
    hideSuggestions,
    onMessageListElementInit,
    setChatStageEl: chatStage.setEl,
    scrollMessageListToEnd,
    setMsgForWhichInfoIsDisplayed,
    getTextOfEditableOrInitialMsg,
    addFilesViaDnD,
    addFiles,
    addFilesViaPaste,
    prepareReplyMessage,
    startEditMsgMode,
    onEmoticonSelect,
    clearInitialInfo,
    clearAttachments,
    finishEditMsgMode,
    deleteAttachment,
    openMediaRecorder,
    sendMessage,

    doAfterMount,
    doBeforeRouteUpdate,
    doBeforeUnMount,
  };
}
