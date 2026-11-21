import { inject } from 'vue';
import dayjs from 'dayjs';
import { DialogsPlugin, DIALOGS_KEY } from '@v1nt1248/3nclient-lib/plugins';
import { getRandomId } from '@v1nt1248/3nclient-lib/utils';
import { inboxSrv } from '@common/services/services-provider';
import { useAppStore, useContactsStore, useMessagesStore, useSendingStore } from '@common/store';
import { handleSendingError, preparedMsgDataToOutgoingMsgView } from '@common/utils';
import { SYSTEM_FOLDERS } from '@common/constants';
import type { IncomingMessageView, OutgoingMessageView, PreparedMessageData } from '@common/types';
import PreFlightDialog from '@common/components/dialogs/pre-flight-dialog/pre-flight-dialog.vue';

export function useCreateMsgActions() {
  const $dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const appStore = useAppStore();
  const { sendMessage } = useSendingStore();
  const { upsertMessage } = useMessagesStore();
  const { isBlacklisted } = useContactsStore();

  async function saveMsgToDraft(msgData: PreparedMessageData): Promise<string> {
    const preparedMsgData = preparedMsgDataToOutgoingMsgView(msgData, SYSTEM_FOLDERS.draft, 'draft');
    await upsertMessage(preparedMsgData);
    return preparedMsgData.msgId!;
  }

  async function runPreFlightProcess(msgData: PreparedMessageData): Promise<{
    recipientsVerificationResult: Record<string, number | string | null>;
    unavailableRecipients: Record<string, string>;
  }> {
    const attachmentsSize = (msgData.attachmentsInfo || []).reduce((acc, item) => {
      acc += item.size;
      return acc;
    }, 0);

    const recipientsVerificationResult = {} as Record<string, number | string | null>;
    for (const recipient of msgData.recipients) {
      if (isBlacklisted(recipient)) {
        // A string rather than a size, so the reduce below counts it among the
        // unavailable - which is what both callers of openSendMessageUI already
        // drop before sending. The server is not asked about somebody this user
        // has refused to hear from.
        recipientsVerificationResult[recipient] = 'blocked';
        continue;
      }
      try {
        recipientsVerificationResult[recipient] = await inboxSrv.preFlight(recipient);
      } catch (err) {
        recipientsVerificationResult[recipient] = handleSendingError<string>({
          err,
        } as web3n.asmail.DeliveryProgress['recipients'][string]);
      }
    }

    const unavailableRecipients = Object.keys(recipientsVerificationResult).reduce(
      (res, address) => {
        const verificationResult = recipientsVerificationResult[address];
        if (typeof verificationResult === 'number' && verificationResult >= attachmentsSize) {
          return res;
        }

        res[address] = (verificationResult || '') as string;
        return res;
      },
      {} as Record<string, string>,
    );

    return {
      recipientsVerificationResult,
      unavailableRecipients,
    };
  }

  async function runMessageSending(msgData: PreparedMessageData) {
    const preparedMsgData = preparedMsgDataToOutgoingMsgView(msgData, SYSTEM_FOLDERS.outbox, 'sending');
    await upsertMessage(preparedMsgData);
    try {
      await sendMessage(preparedMsgData);
    } catch (err) {
      // The dialog is already closed by the time this runs, so a rejection here
      // has nowhere to be shown and used to end up unhandled. Marking the
      // message failed leaves it in the outbox reading as such, which is what a
      // send that never reached delivery should look like. Happens when an
      // attachment's file has gone since the form checked it.
      await w3n.log('error', `Message ${preparedMsgData.msgId} was not handed over for delivery`, err);
      await upsertMessage({ ...preparedMsgData, status: 'error' });
    }
  }

  async function openSendMessageUI(
    msgData: PreparedMessageData,
    t: (key: string, placeholders?: Record<string, string>) => string,
  ): Promise<Record<string, string> | undefined> {
    const res = await $dialogs.$openDialog<Record<string, string>>(PreFlightDialog, {
      msgData,
      dialogProps: {
        title: t('msg.preflight_dialog.title'),
        icon: {
          icon: 'outline-info',
          color: 'var(--color-icon-block-accent-default)',
        },
        closeOnClickOverlay: false,
        closeOnEsc: false,
        confirmButtonText: t('msg.preflight_dialog.confirm_button'),
      },
    });

    switch (res.event) {
      case 'confirm':
        return res.data;

      case 'close':
      case 'cancel':
        return undefined;
    }
  }

  function prepareReplyMsgBody(
    message: IncomingMessageView,
    t: (key: string, placeholders?: Record<string, string>) => string,
    replayForAll?: boolean,
  ) {
    const replyMsgBody = `
      <br/><br/>
      <div>---------- ${t('msg.reply_title')} ----------</div>
      <div>${dayjs(message.deliveryTS).format('YYYY-MM-DD HH:mm')}</div>
      <div>${t('msg.create.label.from')}: ${message.sender}</div>
      <div>${t('msg.create.label.to')}: ${message.recipients?.join(', ')}</div>
      <div>${t('msg.create.label.subject')}: ${message.subject}</div>
      <blockquote>${message.htmlTxtBody || ''}</blockquote>
    `;

    const initialRecipients = (message.recipients || []).filter(address => address !== appStore.user);
    const recipients = replayForAll ? [message.sender, ...initialRecipients] : [message.sender];

    return {
      id: getRandomId(32),
      threadId: message.threadId,
      recipients,
      subject: `Re: ${message.subject}`,
      attachmentsInfo: [],
      htmlTxtBody: replyMsgBody,
    };
  }

  function prepareForwardMsgBody(
    message: IncomingMessageView | OutgoingMessageView,
    t: (key: string, placeholders?: Record<string, string>) => string,
  ) {
    const forwardMsgBody = `
      <br/><br/>
      <div>---------- ${t('msg.forward_title')} ----------</div>
      <div>${message.deliveryTS ? dayjs(message.deliveryTS).format('YYYY-MM-DD HH:mm') : dayjs(message.cTime).format('YYYY-MM-DD HH:mm')}</div>
      <div>${t('msg.create.label.from')}: ${(message as IncomingMessageView).sender || appStore.user}</div>
      <div>${t('msg.create.label.to')}: ${message.recipients?.join(', ')}</div>
      <div>${t('msg.create.label.subject')}: ${message.subject}</div><br/>
      ${message.htmlTxtBody || ''}
    `;

    return {
      id: getRandomId(32),
      threadId: message.threadId,
      recipients: [],
      subject: `Fwd: ${message.subject}`,
      // An attachment of an incoming message is only findable through the
      // message it lives in, and the forward is a different message with a
      // different id — so which one to look in has to be carried along. The
      // attachment form copies such files into the store from there.
      attachmentsInfo: (message.attachmentsInfo || []).map(item =>
        item.type === 'origin' ? { ...item, originMsgId: message.msgId } : item,
      ),
      htmlTxtBody: forwardMsgBody,
    };
  }

  return {
    saveMsgToDraft,
    runPreFlightProcess,
    runMessageSending,
    openSendMessageUI,
    prepareReplyMsgBody,
    prepareForwardMsgBody,
  };
}
