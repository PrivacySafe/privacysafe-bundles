import { computed, inject, onBeforeMount, onBeforeUnmount, provide, readonly, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import get from 'lodash/get';
import isEmpty from 'lodash/isEmpty';
import size from 'lodash/size';
import { NOTIFICATIONS_KEY, NotificationsPlugin, VUEBUS_KEY, VueBusPlugin, DIALOGS_KEY, DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type {
  AppGlobalEvents,
  IncomingMessageView,
  MessageAction,
  MessageBulkActions,
  OutgoingMessageView,
} from '@common/types';
import { useAppStore, useContactsStore, useMessagesStore } from '@common/store';
import { useCreateMsgActions } from '@common/composables/useCreateMsgActions';
import { useContactBlocking } from '@common/composables/useContactBlocking';
import { takeReportAwaitingOutcome } from '@common/composables/sent-reports';
import { msgViewToPreparedMsgData } from '@common/utils';
import { sameAddress } from '@shared/utils/address-utils';
import { MARKED_MESSAGES_INJECTION_KEY } from '@common/constants';
import ReportDialog from '@common/components/dialogs/report-dialog/report-dialog.vue';

export function useFolderContent() {
  const { t } = useI18n();
  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const $notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { getContactList, isBlacklisted } = useContactsStore();
  const appStore = useAppStore();
  const { runContactBlocking } = useContactBlocking();
  const messagesStore = useMessagesStore();
  const { moveToTrash, deleteMessagesUi, bulkMoveToTrash, bulkRestore, upsertMessage } = messagesStore;
  const { openSendMessageUI, runMessageSending, prepareReplyMsgBody, prepareForwardMsgBody } =
    useCreateMsgActions();

  const markedMessages = ref<string[]>([]);

  const numberOfMarkedMessages = computed(() => size(markedMessages.value));
  const selectedMessageId = computed(() => (numberOfMarkedMessages.value === 1 ? markedMessages.value[0] : null));

  function markMessage(msgId: string) {
    const index = markedMessages.value.findIndex(id => id === msgId);
    if (index === -1) {
      markedMessages.value.push(msgId);
    } else {
      markedMessages.value.splice(index, 1);
    }
  }

  function setMarkedMessages(value: string[]) {
    markedMessages.value = value;
  }

  function resetMarkMessages() {
    markedMessages.value = [];
  }

  /**
   * Whether a reply to this message is refused because its sender is blocked.
   *
   * The buttons for it are hidden already, but hidden is not forbidden: they are
   * drawn off a list another app changes under them, and the action also arrives
   * from the message view without passing a button at all.
   *
   * @returns true when the reply was refused and the caller is to stop.
   */
  function refuseReplyToBlocked(
    message: IncomingMessageView | OutgoingMessageView,
  ): boolean {
    const sender = (message as IncomingMessageView).sender;
    if (!sender || !isBlacklisted(sender)) {
      return false;
    }
    $notifications.$createNotice({
      type: 'error',
      content: t('msg.content.blocked_reply'),
      duration: 4000,
    });
    return true;
  }

  async function startCreateReport(message: IncomingMessageView) {
    if (!message) {
      return;
    }

    // The report that leaves puts itself among the ones awaiting an outcome:
    // one place doing it for both form-factors, and the phone's page of a form
    // is gone by the time the delivery ends.
    await dialog.$openDialog<string>(ReportDialog, {
      message,
    });
  }

  async function handleMessageAction({
    action,
    message,
    sourceFolder,
  }: {
    action: MessageAction;
    message: IncomingMessageView | OutgoingMessageView;
    sourceFolder?: string;
  }) {
    switch (action) {
      case 'edit': {
        resetMarkMessages();
        $bus.$emitter.emit('run-create-message', {
          data: {
            id: get(message, 'msgId'),
            threadId: get(message, ['threadId']),
            recipients: get(message, 'recipients', []),
            subject: get(message, 'subject', ''),
            attachmentsInfo: get(message, 'attachmentsInfo', []),
            htmlTxtBody: get(message, ['htmlTxtBody']),
          },
        });
        break;
      }

      case 'move-to-trash': {
        resetMarkMessages();
        await moveToTrash(message);
        break;
      }

      case 'delete': {
        const res = await deleteMessagesUi([message.msgId!]);
        if (res) {
          resetMarkMessages();
        }
        break;
      }

      case 'send': {
        resetMarkMessages();
        const sendingMessageData = {
          ...msgViewToPreparedMsgData(message),
          status: 'sending',
        };
        const unavailableRecipients = await openSendMessageUI(sendingMessageData, t);

        const availableRecipients = isEmpty(unavailableRecipients)
          ? sendingMessageData.recipients
          : sendingMessageData.recipients.filter(address => !unavailableRecipients[address]);

        if (isEmpty(availableRecipients)) {
          $notifications.$createNotice({
            type: 'error',
            content: t('msg.content.preflight_error'),
            duration: 4000,
          });
          return;
        }

        sendingMessageData.recipients = availableRecipients;
        await runMessageSending(sendingMessageData);
        break;
      }

      case 'reply': {
        if (refuseReplyToBlocked(message)) {
          break;
        }
        const replyMsgData = prepareReplyMsgBody(message as IncomingMessageView, t);
        $bus.$emitter.emit('run-create-message', { data: replyMsgData, isThisReplyOrForward: true, sourceFolder });
        break;
      }

      case 'reply-all': {
        if (refuseReplyToBlocked(message)) {
          break;
        }
        const replyMsgData = prepareReplyMsgBody(message as IncomingMessageView, t, true);
        $bus.$emitter.emit('run-create-message', { data: replyMsgData, isThisReplyOrForward: true, sourceFolder });
        break;
      }

      case 'forward': {
        const forwardMsgData = prepareForwardMsgBody(message, t);
        $bus.$emitter.emit('run-create-message', {
          data: forwardMsgData,
          isThisReplyOrForward: true,
          sourceFolder,
        });
        break;
      }

      case 'restore': {
        // Which folder a restored message belongs in is worked out by the
        // service, from homeFolderOf(). A copy of that rule here would diverge
        // from it on the first message whose sending failed - and the two
        // devices with it.
        resetMarkMessages();
        await bulkRestore([message.msgId]);
        break;
      }

      case 'mark-as-read': {
        await upsertMessage({
          ...message,
          status: 'read',
        });
        break;
      }

      case 'block':
      case 'unblock': {
        // The buttons for these are hidden already, but hidden is not
        // forbidden: they are drawn off a list another app changes under them,
        // and one's own address must never reach the blacklist.
        const sender = (message as IncomingMessageView).sender;
        if (!sender || sameAddress(sender, appStore.user)) {
          break;
        }
        // runContactBlocking() asks the user and is a no-op when the address is
        // already in the asked-for state, so nothing is checked here twice.
        await runContactBlocking(sender, action === 'block');
        break;
      }

      case 'report': {
        startCreateReport(message as IncomingMessageView);
        break;
      }

      // no default
    }
  }

  async function handleMessageBulkActions({
    action,
    messageIds,
  }: {
    action: MessageBulkActions;
    messageIds: string[];
  }) {
    switch (action) {
      case 'cancel':
        resetMarkMessages();
        break;
      case 'move-to-trash': {
        resetMarkMessages();
        await bulkMoveToTrash(messageIds);
        break;
      }
      case 'delete': {
        const res = await deleteMessagesUi(messageIds);
        if (res) {
          resetMarkMessages();
        }
        break;
      }
      case 'restore': {
        resetMarkMessages();
        await bulkRestore(messageIds);
        break;
      }
    }
  }

  function onMsgSendingComplete({ id, status }: { id: string; status: 'ok' | 'error' }) {
    if (markedMessages.value.includes(id)) {
      markMessage(id);
    }

    // Told about once: a report is one message, and its delivery ends once.
    if (takeReportAwaitingOutcome(id)) {
      $notifications.$createNotice({
        type: status === 'ok' ? 'success' : 'error',
        content:
          status === 'ok'
            ? t('dialog.report-dialog.notif.sent')
            : t('dialog.report-dialog.notif.sendError'),
        duration: 4000,
      });
    }
  }

  provide(MARKED_MESSAGES_INJECTION_KEY, {
    markedMessages: readonly(markedMessages),
    markMessage,
    setMarkedMessages,
    resetMarkMessages,
  });

  function onOpenInboxMsg({ msgId }: { msgId: string }) {
    setMarkedMessages([msgId]);
  }

  onBeforeMount(async () => {
    $bus.$emitter.on('sending-complete', onMsgSendingComplete);
    $bus.$emitter.on('open-inbox-msg', onOpenInboxMsg);

    await getContactList();
  });

  onBeforeUnmount(() => {
    $bus.$emitter.off('sending-complete', onMsgSendingComplete);
    $bus.$emitter.off('open-inbox-msg', onOpenInboxMsg);
  });

  return {
    markedMessages,
    selectedMessageId,
    markMessage,
    setMarkedMessages,
    resetMarkMessages,
    handleMessageAction,
    handleMessageBulkActions,
  };
}
