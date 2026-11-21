<!--
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
-->
<script lang="ts" setup>
  import { computed, inject, onBeforeMount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import cloneDeep from 'lodash/cloneDeep';
  import isEqual from 'lodash/isEqual';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { inboxSrv } from '@common/services/services-provider';
  import { AttachmentInfo } from '@common/types';
  import type { FileInfo } from '@deno/types/inbox-srv.types';
  import { ATTACHMENT_COPY_THRESHOLD, MAX_ATTACHMENT_SIZE } from '@shared/constants/attachment-limits';
  import AttachedItem from './attached-item.vue';

  const props = defineProps<{
    msgId: string;
    value?: AttachmentInfo[];
  }>();
  const emits = defineEmits<{
    (event: 'update', value: AttachmentInfo[]): void;
    (event: 'update:loading', value: boolean): void;
    /** Something has to be sorted out before the message can be sent. */
    (event: 'update:blocked', value: boolean): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const innerValue = ref<AttachmentInfo[]>([]);
  /** File names still being copied into the store, shown as busy chips. */
  const beingAttached = ref<string[]>([]);
  /**
   * Attachments whose file cannot be read here — moved, renamed or deleted, or
   * attached on another device of the user.
   *
   * Keyed by keyOf() rather than by id, because a record that came from another
   * device carries no id at all.
   */
  const unavailableKeys = ref<string[]>([]);

  const isLoading = computed(() => !isEmpty(beingAttached.value));
  const isBlocked = computed(() => !isEmpty(unavailableKeys.value));

  /**
   * Identity of an attachment inside this form. An id when there is one; the
   * file name otherwise, which is what a record from another device has.
   */
  function keyOf(item: AttachmentInfo): string {
    return item.id ?? `name:${item.fileName}`;
  }

  function titleOfUnavailable(item: AttachmentInfo): string {
    // Not the same thing as a broken link, and not to be said as if it were: the
    // file is whole and well, it is simply on the user's other device.
    return item.hasNoLocalSource
      ? t('msg.attachment.on_another_device', { fileName: item.fileName })
      : t('msg.attachment.unavailable', { fileName: item.fileName });
  }

  watch(isLoading, value => emits('update:loading', value));
  watch(isBlocked, value => emits('update:blocked', value));

  async function attachFile(file: web3n.files.ReadonlyFile, fileSize: number): Promise<AttachmentInfo> {
    if (fileSize > ATTACHMENT_COPY_THRESHOLD) {
      // Left where it is, with only a reference kept: ASMail reads attachments
      // lazily and in chunks while packing, so a big file never has to be
      // duplicated. Unlike a copy, this is only as good as the file it points
      // at - `external` is what tells the rest of the app to say so when the
      // user has moved or deleted it.
      const id = await inboxSrv.addLink(file, { fileName: file.name, messages: [props.msgId] });
      return { id, fileName: file.name, size: fileSize, external: true };
    }

    // Small enough to be worth a copy, which keeps the draft usable after a
    // restart and leaves something to download from the sent message. The copy
    // is made by reference: no bytes cross this app's IPC.
    const id = await inboxSrv.addFile(file, { fileName: file.name, messages: [props.msgId] });
    return { id, fileName: file.name, size: fileSize };
  }

  async function openUploadDialog() {
    const res = await w3n.shell?.fileDialogs?.openFileDialog?.(
      t('msg.create.btn.attach'),
      t('app.select'),
      true,
    );
    if (isEmpty(res)) {
      return;
    }

    let addedAny = false;
    for (const file of res!) {
      // Per file, so that one unattachable file does not lose the others,
      // and so that the log names the file that failed.
      beingAttached.value.push(file.name);
      try {
        const { size = 0 } = await file.stat();
        if (size > MAX_ATTACHMENT_SIZE) {
          $createNotice({
            type: 'error',
            content: t('msg.attachment.too_big.error', {
              fileName: file.name,
              limit: formatFileSize(MAX_ATTACHMENT_SIZE),
            }),
          });
          continue;
        }

        innerValue.value.push(await attachFile(file, size));
        addedAny = true;
      } catch (error) {
        w3n.log('error', `Error attaching the file '${file.name}' to the message ${props.msgId}`, error);

        $createNotice({
          type: 'error',
          content: t('msg.attachment.attaching.error', { fileName: file.name }),
        });
      } finally {
        const index = beingAttached.value.indexOf(file.name);
        index > -1 && beingAttached.value.splice(index, 1);
      }
    }

    if (addedAny) {
      emits('update', innerValue.value);
    }
  }

  /**
   * Drops this message's claim on a stored attachment. The item itself goes only
   * when no other message references it — a copy and a link to a file on the
   * device are handled the same way, the difference being that deleting a link
   * leaves the user's own file alone.
   */
  async function unlinkFromMessage(id: string): Promise<void> {
    const { messages = [] } = (await inboxSrv.getInfo(id)) as FileInfo;
    // We check if this file is used as an attachment in any other message
    if (size(messages) > 1) {
      const currentMsgIndex = messages.findIndex(mId => mId === props.msgId);
      currentMsgIndex > -1 && messages.splice(currentMsgIndex, 1);
      await inboxSrv.updateInfo(id, { messages });
    } else {
      await inboxSrv.deleteFile(id);
    }
  }

  async function removeItem(itemKey: string) {
    const itemIndex = innerValue.value.findIndex(f => keyOf(f) === itemKey);
    if (itemIndex === -1) {return;}

    const { id, type, fileName } = innerValue.value[itemIndex];
    try {
      // Without an id there is nothing in this device's store to unlink from:
      // the bytes are on another device.
      if (!type && id) {
        await unlinkFromMessage(id);
      }
    } catch (error) {
      w3n.log('error', `Error removing the file '${fileName}' from the message ${props.msgId}`, error);

      $createNotice({
        type: 'error',
        content: t('msg.attachment.removing.error', { fileName }),
      });
      return;
    }

    innerValue.value.splice(itemIndex, 1);
    const unavailableIndex = unavailableKeys.value.indexOf(itemKey);
    unavailableIndex > -1 && unavailableKeys.value.splice(unavailableIndex, 1);
    emits('update', innerValue.value);
  }

  async function removeAll() {
    const pr = [] as Promise<void>[];
    for (const item of innerValue.value) {
      if (!item.type && item.id) {
        pr.push(unlinkFromMessage(item.id));
      }
    }

    const results = await Promise.allSettled(pr);
    // allSettled never rejects, so without this a failed removal is silent.
    for (const result of results) {
      if (result.status === 'rejected') {
        w3n.log('error', `Error removing an attachment of the message ${props.msgId}`, result.reason);
      }
    }

    innerValue.value = [];
    unavailableKeys.value = [];
    emits('update', []);
  }

  async function removeAllWithReporting() {
    try {
      await removeAll();
    } catch (error) {
      w3n.log('error', `Error removing attachments of the message ${props.msgId}`, error);

      $createNotice({
        type: 'error',
        content: t('msg.attachments.removing.error'),
      });
    }
  }

  /**
   * Marks the attachments that cannot be sent from this device, so that the form
   * says so instead of failing at send time. Blocking the send is the point: a
   * message that went out without its attachment is worse than one that did not
   * go out.
   *
   * Two kinds, and only one of them costs a read:
   *
   *  - an external attachment is a reference to a file the user owns, so it can
   *    stop resolving between sessions — moved, renamed or deleted. Only this
   *    kind is checked; copies are not, the store owning those;
   *  - a record that came from another device of the user carries no bytes here
   *    at all, and no call is made for it — the answer is known in advance.
   *
   * The same pass covers a forward, prepareForwardMsgBody carrying
   * attachmentsInfo across as it is.
   */
  async function markUnavailableAttachments(): Promise<void> {
    const onAnotherDevice = innerValue.value.filter(item => item.hasNoLocalSource);
    const external = innerValue.value.filter(item => item.external && !item.hasNoLocalSource);

    const checks = await Promise.allSettled(external.map(item => inboxSrv.hasAttachment(item.id)));
    const found = [
      ...onAnotherDevice.map(keyOf),
      ...external
        .filter((_, i) => {
          const check = checks[i];
          return check.status === 'rejected' || !check.value;
        })
        .map(keyOf),
    ];
    // Added to rather than assigned: materializeIncomingAttachments runs first
    // and marks whatever it could not copy, and an assignment here would drop
    // exactly that.
    unavailableKeys.value = [...new Set([...unavailableKeys.value, ...found])];
  }

  /**
   * Attachments of a forwarded incoming message live inside that message, not in
   * the store: `prepareForwardMsgBody` copies their records as they are, with
   * `type: 'origin'` and an id that is no id in the store. Such a forward cannot
   * be sent at all, so each of them is copied into the store here.
   *
   * A copy, not a reference: the message they live in is one this app itself
   * removes when the user deletes the mail, and deleting a message after
   * forwarding it is an ordinary thing to do. As a stored copy the file also
   * comes under the same reference counting as every other attachment.
   */
  async function materializeIncomingAttachments(): Promise<void> {
    // hasNoLocalSource excluded: those bytes are on another device, not in a
    // message of the shared inbox this one can read.
    const incoming = innerValue.value.filter(
      item => item.type === 'origin' && item.originMsgId && !item.hasNoLocalSource,
    );
    if (isEmpty(incoming)) {return;}

    for (const item of incoming) {
      beingAttached.value.push(item.fileName);
      try {
        const id = await inboxSrv.storeIncomingAttachment(
          item.originMsgId!,
          item.fileName,
          props.msgId,
        );
        const index = innerValue.value.findIndex(f => keyOf(f) === keyOf(item));
        index > -1 && (innerValue.value[index] = { id, fileName: item.fileName, size: item.size });
      } catch (error) {
        w3n.log(
          'error',
          `Error copying the attachment '${item.fileName}' of message ${item.originMsgId} into the store`,
          error,
        );
        // Left as it is and marked unavailable, which blocks sending: better
        // than a message that goes out with an attachment missing.
        unavailableKeys.value.push(keyOf(item));
      } finally {
        const index = beingAttached.value.indexOf(item.fileName);
        index > -1 && beingAttached.value.splice(index, 1);
      }
    }

    emits('update', innerValue.value);
  }

  /**
   * Every stored attachment has to count this message among the ones that
   * reference it, one of them as much as several: a forward carries the same
   * stored files under a *new* msgId (see prepareForwardMsgBody), and without
   * this its files are still owned by the original message alone — deleting
   * which then deletes them out from under the forward.
   */
  async function relinkStoredAttachments(): Promise<void> {
    const stored = innerValue.value.filter(item => !item.type && item.id);
    if (isEmpty(stored)) {return;}

    try {
      const pr = [] as Promise<void>[];
      for (const item of stored) {
        const { messages = [] } = (await inboxSrv.getInfo(item.id!)) as FileInfo;
        if (!messages.includes(props.msgId)) {
          messages.push(props.msgId);
          pr.push(inboxSrv.updateInfo(item.id!, { messages }));
        }
      }

      const results = await Promise.allSettled(pr);
      for (const result of results) {
        if (result.status === 'rejected') {
          w3n.log('error', `Error linking an attachment to the message ${props.msgId}`, result.reason);
        }
      }
    } catch (error) {
      w3n.log('error', `Error linking attachments to the message ${props.msgId}`, error);

      $createNotice({
        type: 'error',
        content: t('msg.attachments.linking.error'),
      });
    }
  }

  onBeforeMount(async () => {
    innerValue.value = cloneDeep(props.value) ?? [];
    if (isEmpty(innerValue.value)) {return;}

    // Order matters: incoming attachments become stored ones first, so that the
    // two passes below see a single kind of item.
    await materializeIncomingAttachments();
    await markUnavailableAttachments();
    await relinkStoredAttachments();
  });

  watch(
    () => props.value,
    val => {
      if (!isEmpty(val) && !isEqual(val!, innerValue.value)) {
        innerValue.value = cloneDeep(props.value || []);
      }
    },
  );
</script>

<template>
  <div :class="$style.attachments">
    <template
      v-for="file in innerValue"
      :key="keyOf(file)"
    >
      <attached-item
        :item-name="file.fileName"
        :disabled="isLoading"
        :unavailable="unavailableKeys.includes(keyOf(file))"
        :unavailable-title="titleOfUnavailable(file)"
        @close="removeItem(keyOf(file))"
      />
    </template>

    <template
      v-for="fileName in beingAttached"
      :key="`attaching-${fileName}`"
    >
      <attached-item
        :item-name="fileName"
        busy
        disabled
      />
    </template>

    <ui3n-button
      type="secondary"
      icon="round-attach-file"
      icon-position="left"
      icon-color="var(--color-icon-button-secondary-default)"
      :disabled="isLoading"
      @click.stop.prevent="openUploadDialog"
    >
      {{ t('msg.create.btn.attach') }}
    </ui3n-button>

    <ui3n-button
      type="icon"
      color="transparent"
      icon="outline-delete"
      icon-color="var(--color-icon-button-secondary-default)"
      :class="$style.deleteBtn"
      :disabled="isLoading"
      @click.stop.prevent="removeAllWithReporting"
    />
  </div>
</template>

<style lang="scss" module>
  .attachments {
    position: relative;
    display: flex;
    width: 100%;
    min-height: var(--spacing-l);
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: center;
    gap: var(--spacing-s);
    padding-right: 36px;
  }

  button.deleteBtn {
    position: absolute;
    right: 0;
    top: 0;
  }
</style>
