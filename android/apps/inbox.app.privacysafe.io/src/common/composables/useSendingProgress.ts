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
import { computed, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import get from 'lodash/get';
import size from 'lodash/size';
import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
import { useSendingStore } from '@common/store';

/**
 * How far along the delivery of one outgoing message is.
 *
 * ASMail packs and uploads attachments in chunks as it goes, so `bytesSent`
 * grows through the whole send — which is what makes this worth showing for a
 * message with a big attachment, where the send is the long part.
 */
export function useSendingProgress(msgId: Ref<string | undefined> | ComputedRef<string | undefined>) {
  const { t } = useI18n();

  const { listOfSendingMessage } = storeToRefs(useSendingStore());

  const messageProgress = computed(() =>
    msgId.value ? get(listOfSendingMessage.value, msgId.value, null) : null,
  );

  const totalBytes = computed(() => {
    if (!messageProgress.value) {return 0;}

    const { msgSize, recipients } = messageProgress.value;
    return msgSize * size(recipients);
  });

  const sentBytes = computed(() => {
    if (!messageProgress.value) {return 0;}

    const { recipients } = messageProgress.value;
    return Object.keys(recipients).reduce((res, address) => res + (recipients[address].bytesSent ?? 0), 0);
  });

  const percent = computed(() => (totalBytes.value === 0 ? 0 : (sentBytes.value / totalBytes.value) * 100));

  const progressText = computed(() =>
    t('msg.sending.progress', {
      percent: `${percent.value.toFixed(1)}%`,
      currentValue: formatFileSize(sentBytes.value),
      totalValue: formatFileSize(totalBytes.value),
    }),
  );

  return {
    messageProgress,
    totalBytes,
    sentBytes,
    percent,
    progressText,
  };
}
