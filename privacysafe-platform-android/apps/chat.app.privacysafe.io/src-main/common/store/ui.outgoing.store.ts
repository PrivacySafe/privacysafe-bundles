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
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { ChatMessageSendingProgressEvent } from '~/services.types.ts';
import { LocalMetadataInDelivery } from '~/chat.types.ts';

export const useUiOutgoingStore = defineStore('ui-outgoing', () => {
  const msgsSendingProgress = ref<
    Record<
      string,
      {
        deliveryId: string;
        progress: number;
      }
    >
  >({});

  function updateSendingProgressesList(event: ChatMessageSendingProgressEvent) {
    const { data } = event;
    const { id: deliveryId, progress } = data;
    const { localMeta, allDone, msgSize, recipients } = progress;

    const chatMsgInfo = JSON.stringify([
      (localMeta as LocalMetadataInDelivery).chatId.chatId,
      (localMeta as LocalMetadataInDelivery).chatMessageId,
    ]);

    if (allDone) {
      removeRecordFromSendingProgressesList(chatMsgInfo);
      return;
    }

    const bytesSent = Object.values(recipients).reduce((res, item) => {
      res += item.bytesSent;
      return res;
    }, 0);

    msgsSendingProgress.value[chatMsgInfo] = {
      deliveryId,
      progress: Math.min(Math.round((bytesSent / msgSize) * 100), 100),
    };
  }

  function removeRecordFromSendingProgressesList(msgInfo: string) {
    delete msgsSendingProgress.value[msgInfo];
  }

  function clearSendingProgressesList() {
    msgsSendingProgress.value = {};
  }

  return {
    msgsSendingProgress,
    updateSendingProgressesList,
    removeRecordFromSendingProgressesList,
    clearSendingProgressesList,
  };
});
