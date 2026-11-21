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
import { inject, toRaw, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import {
  DIALOGS_KEY,
  type DialogsPlugin,
  NOTIFICATIONS_KEY,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import type { OutgoingAttachment } from '~/index';
import { useChatStore } from '@main/common/store/chat.store';
import ChatMediaRecorderDialog from '@main/common/components/dialogs/chat-media-recorder/chat-media-recorder-dialog.vue';
import type { MediaRecordingResult } from '@main/common/components/dialogs/chat-media-recorder/useMediaRecorder';
import { nameForRecording } from '@shared/media-recording-format';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatViewRecording');

/**
 * What the recording zone takes from the view around it: the composer's input
 * (the recorder leaves it as it was), the button flag that gates the recorder,
 * the composer-owned storage item factory, and the set of items this view owns.
 */
export interface ChatViewRecordingDeps {
  inputEl: Ref<Nullable<HTMLTextAreaElement>>;
  recordBtnDisabled: ComputedRef<boolean>;
  fileTo3nFile: (f: File) => Promise<OutgoingAttachment | undefined>;
  ownedStoredIds: Set<string>;
}

/**
 * The voice/video recorder of the composer: it opens the recorder dialog and,
 * when a recording is approved there, sends it as a message of its own.
 */
export function useChatViewRecording({
  inputEl,
  recordBtnDisabled,
  fileTo3nFile,
  ownedStoredIds,
}: ChatViewRecordingDeps) {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);
  const { currentChatId } = storeToRefs(useChatStore());
  const { sendMessageInChat } = useChatStore();

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

  return {
    openMediaRecorder,
    sendRecordingAsMessage,
  };
}

export type ChatViewRecording = ReturnType<typeof useChatViewRecording>;
