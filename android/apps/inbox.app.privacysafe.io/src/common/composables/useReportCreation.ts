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
import { computed, inject, onBeforeMount, ref, toValue, type MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import isEmpty from 'lodash/isEmpty';
import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
import { getRandomId } from '@v1nt1248/3nclient-lib/utils';
import { inboxSrv } from '@common/services/services-provider';
import { useContactsStore } from '@common/store';
import { useCreateMsgActions } from '@common/composables/useCreateMsgActions';
import { reportAwaitsOutcome } from '@common/composables/sent-reports';
import type { AttachmentInfo, IncomingMessageView, PreparedMessageData } from '@common/types';
import { parseAddress, sameAddress } from '@shared/utils/address-utils';
import { attachmentAvailabilityOf } from '@shared/utils/attachment-availability';
import { makeLogger } from '@shared/utils/logger';
import { prepareReportMsgBody } from '@common/components/dialogs/report-dialog/prepare-report-body';

const log = makeLogger('ReportCreation');

export type ReportFieldUpdate =
  | { field: 'reasons'; value: string[] }
  | { field: 'include-message'; value: boolean }
  | { field: 'include-attachments'; value: boolean }
  | { field: 'details'; value: string }
  | { field: 'block'; value: boolean };

export interface ReportCreationCallbacks {
  /** The report is handed to delivery: whoever opened the form closes it. */
  onSent: (reportMsgId: string) => void;
  /** There is nowhere to send it; the user is told already. */
  onNoReportAddress: () => void;
}

export function useReportCreation(
  message: MaybeRefOrGetter<IncomingMessageView>,
  { onSent, onNoReportAddress }: ReportCreationCallbacks,
) {
  const { t } = useI18n();
  const notif = inject(NOTIFICATIONS_KEY)!;

  const { isBlacklisted, setContactBlocking } = useContactsStore();
  const { runMessageSending } = useCreateMsgActions();

  const step = ref(1);
  const reportAddress = ref<string | undefined>(undefined);
  const reasons = ref<string[]>([]);
  const includeMessage = ref(false);
  const includeAttachments = ref(false);
  const additionalDetails = ref<string>('');
  const shouldBlockContact = ref(false);
  const isSending = ref(false);

  const hasAttachments = computed(() => !isEmpty(toValue(message).attachmentsInfo));
  const actionBtnText = computed(() => (step.value === 1 ? t('app.btn.continue') : t('app.btn.send')));
  const disableActionBtn = computed(() => {
    if (isSending.value || !reportAddress.value) {
      return true;
    }
    return step.value === 1 && isEmpty(reasons.value);
  });

  function onFieldUpdate({ field, value }: ReportFieldUpdate): void {
    switch (field) {
      case 'reasons':
        reasons.value = value;
        break;

      case 'include-message':
        includeMessage.value = value;
        break;

      case 'include-attachments':
        includeAttachments.value = value;
        break;

      case 'details':
        additionalDetails.value = value;
        break;

      case 'block':
        shouldBlockContact.value = value;
        break;

      // no default
    }
  }

  async function blockReportedSender(): Promise<void> {
    const { sender } = toValue(message);
    if (isBlacklisted(sender)) {
      return;
    }

    try {
      await setContactBlocking(sender, true);
      notif.$createNotice({
        type: 'success',
        content: t('dialog.report-dialog.notif.blocked', { mail: sender }),
        duration: 4000,
      });
    } catch (err) {
      log.error(`Failed to block ${sender} while reporting their message.`, err);
      notif.$createNotice({
        type: 'error',
        content: t('contact.error.block'),
        duration: 4000,
      });
    }
  }

  async function materializeReportAttachments(
    reportMsgId: string,
  ): Promise<{ attached: AttachmentInfo[]; failed: string[] }> {
    const reportedMsg = toValue(message);
    const attached: AttachmentInfo[] = [];
    const failed: string[] = [];

    for (const item of reportedMsg.attachmentsInfo || []) {
      if (attachmentAvailabilityOf(item, reportedMsg.msgId) !== 'in-incoming-msg') {
        failed.push(item.fileName);
        continue;
      }

      try {
        const id = await inboxSrv.storeIncomingAttachment(reportedMsg.msgId, item.fileName, reportMsgId);
        attached.push({ id, fileName: item.fileName, size: item.size });
      } catch (err) {
        log.error(
          `Error copying the attachment '${item.fileName}' of message ${reportedMsg.msgId} into report ${reportMsgId}`,
          err,
        );
        failed.push(item.fileName);
      }
    }

    return { attached, failed };
  }

  async function sendReport(): Promise<void> {
    const reportedMsg = toValue(message);
    const { sender } = reportedMsg;
    const recipient = reportAddress.value!;
    const blockingRefusesReport = sameAddress(sender, recipient);

    isSending.value = true;
    try {
      const reportMsgId = getRandomId(32);

      if (shouldBlockContact.value && !blockingRefusesReport) {
        await blockReportedSender();
      }

      const { attached, failed } =
        includeAttachments.value && hasAttachments.value
          ? await materializeReportAttachments(reportMsgId)
          : { attached: [] as AttachmentInfo[], failed: [] as string[] };

      if (!isEmpty(failed)) {
        notif.$createNotice({
          type: 'warning',
          content: t('dialog.report-dialog.notif.attachmentsError'),
          duration: 4000,
        });
      }

      const msgData: PreparedMessageData = {
        id: reportMsgId,
        threadId: getRandomId(32),
        recipients: [recipient],
        subject: t('msg.create.report.subject'),
        attachmentsInfo: attached,
        htmlTxtBody: prepareReportMsgBody({
          message: reportedMsg,
          reasons: reasons.value,
          additionalDetails: additionalDetails.value,
          includeMessage: includeMessage.value,
          attachedNames: attached.map(item => item.fileName),
          failedNames: failed,
          t,
        }),
      };

      try {
        await runMessageSending(msgData);
      } catch (err) {
        log.error(`Failed to put the report ${reportMsgId} into the outbox.`, err);
        notif.$createNotice({
          type: 'error',
          content: t('dialog.report-dialog.notif.sendError'),
          duration: 4000,
        });
        return;
      }

      notif.$createNotice({
        type: 'info',
        content: t('dialog.report-dialog.notif.sending'),
        duration: 4000,
      });

      if (shouldBlockContact.value && blockingRefusesReport) {
        await blockReportedSender();
      }

      // Registered here, and not by the caller: this form is gone by the time
      // the delivery ends, on the phone from the screen as well.
      reportAwaitsOutcome(reportMsgId);
      onSent(reportMsgId);
    } finally {
      isSending.value = false;
    }
  }

  function runAction() {
    if (step.value === 1) {
      step.value += 1;
      return;
    }

    if (disableActionBtn.value) {
      return;
    }

    if (isBlacklisted(reportAddress.value!)) {
      notif.$createNotice({
        type: 'error',
        content: t('dialog.report-dialog.notif.reportAddressBlocked', { mail: reportAddress.value! }),
        duration: 4000,
      });
      return;
    }

    sendReport();
  }

  function stepBack() {
    if (step.value > 1) {
      step.value -= 1;
    }
  }

  function notifyNoReportAddress() {
    notif.$createNotice({
      type: 'warning',
      content: t('dialog.report-dialog.notif.noReportAddress'),
      duration: 4000,
    });
    onNoReportAddress();
  }

  onBeforeMount(async () => {
    const { sender } = toValue(message);
    const { domain } = parseAddress(sender);

    try {
      reportAddress.value = await inboxSrv.getReportAddressForDomain(domain);
      if (!reportAddress.value) {
        log.error(`No report address is known for the domain ${domain}.`);
        notifyNoReportAddress();
      }
    } catch (err) {
      log.error(`Failed to get the report address for the domain ${domain}.`, err);
      notifyNoReportAddress();
    }
  });

  return {
    step,
    reportAddress,
    reasons,
    includeMessage,
    includeAttachments,
    additionalDetails,
    shouldBlockContact,
    isSending,
    hasAttachments,
    actionBtnText,
    disableActionBtn,
    onFieldUpdate,
    runAction,
    stepBack,
  };
}
