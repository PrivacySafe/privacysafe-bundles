<script lang="ts" setup>
  import { computed, ref, watch } from 'vue';
  import isEmpty from 'lodash/isEmpty';
  import { markSearch } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nAutocomplete, Ui3nChip, Ui3nHtml, Ui3nInput } from '@v1nt1248/3nclient-lib';
  import { useCreateMsg } from '@/common/components/dialogs/create-msg-dialog/useCreateMsg';
  import type { CreateMsgDialogEmits } from '@common/components/dialogs/create-msg-dialog/types';
  import type { PreparedMessageData } from '@common/types';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';
  import AttachToOutgoingMessage from '@common/components/attach-to-outgoing-message/attach-to-outgoing-message.vue';
  import TextEditor from '@common/components/text-editor/text-editor.vue';

  const vUi3nHtml = Ui3nHtml;

  // The send button lives in the toolbar next to this form, not in it, so the
  // form has to say out loud when the message is not ready to go.
  interface MessageFormEmits extends CreateMsgDialogEmits {
    (event: 'update:busy', value: boolean): void;
  }

  const props = defineProps<{ data: PreparedMessageData; isThisReplyOrForward?: boolean }>();
  const emits = defineEmits<MessageFormEmits>();

  const hasBlockingAttachments = ref(false);

  const {
    t,
    isLoading,
    msgData,
    contactList,
    isContactBlocked,
    getDisplayItem,
    filterContactList,
    onMsgDataUpdateDebounced,
    cancelPendingSave,
    removeRecipient,
    updateAttachments,
    showEditorToolbar,
    onEditorInit,
    msgBodyUpdate,
  } = useCreateMsg({ props, emits, isMobileMode: true });

  const isBusy = computed(() => isLoading.value || hasBlockingAttachments.value);

  watch(isBusy, value => emits('update:busy', value), { immediate: true });

  // Send and Discard sit in the page's toolbar rather than in this form, so the
  // page is the one that has to drop a save still waiting: after a deletion it
  // would bring the draft back, and after a handover to delivery it would write
  // the message out as a draft again.
  defineExpose({ cancelPendingSave });
</script>

<template>
  <div :class="$style.messageForm">
    <div :class="[$style.block, $style.blockStyle2]">
      <span :class="$style.blockTitle">{{ t('msg.create.label.subject') }}:</span>
      <div :class="$style.blockContent">
        <ui3n-input
          v-model="msgData.subject"
          :disabled="isLoading"
          @update:model-value="onMsgDataUpdateDebounced"
        />
      </div>
    </div>

    <div :class="[$style.block, $style.blockStyle1]">
      <span :class="$style.blockTitle"> {{ t('msg.create.label.to') }}: </span>

      <div :class="$style.blockContent">
        <ui3n-autocomplete
          v-model="msgData.recipients"
          :placeholder="t('msg.create.placeholder.contacts')"
          :items="contactList"
          :custom-filter="filterContactList"
          :item-disabled="isContactBlocked"
          chips
          clear-on-select
          hide-selected
          multiple
          item-title="displayName"
          item-value="mail"
          add-new-value
          :new-value-validator="(v: string) => v.includes('@')"
          :disabled="isLoading"
          :class="isEmpty(msgData.recipients) && $style.noRecipients"
          @update:model-value="onMsgDataUpdateDebounced"
        >
          <template #item="{ item, query }">
            <div :class="$style.item">
              <span
                v-ui3n-html="markSearch(getDisplayItem(item), query || '')"
                :class="$style.itemName"
              />

              <!-- As on the desktop: the row is inert, and this says why. -->
              <span
                v-if="isContactBlocked(item)"
                :class="$style.itemBlocked"
              >
                {{ t('contact.blocked.mark') }}
              </span>
            </div>
          </template>

          <template #chip="{ item }">
            <ui3n-chip
              height="32"
              max-width="100%"
              closeable
              :disabled="isLoading"
              @close="removeRecipient(item as string)"
            >
              <template #left>
                <contact-icon
                  :size="24"
                  :name="item as string"
                  readonly
                />
              </template>

              <span :class="$style.chipText">
                {{ item }}
              </span>
            </ui3n-chip>
          </template>
        </ui3n-autocomplete>
      </div>
    </div>

    <div :class="[$style.block, $style.blockStyle2]">
      <attach-to-outgoing-message
        :msg-id="msgData.id"
        :value="data?.attachmentsInfo"
        @update="updateAttachments"
        @update:loading="isLoading = $event"
        @update:blocked="hasBlockingAttachments = $event"
      />
    </div>

    <text-editor
      :autofocus="isThisReplyOrForward"
      :text="data?.htmlTxtBody"
      :placeholder="t('msg.create.placeholder.editor')"
      :show-toolbar="showEditorToolbar"
      :disabled="isLoading"
      @init="onEditorInit"
      @update:text="msgBodyUpdate"
    />
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .messageForm {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .block {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    column-gap: var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);

    .noRecipients {
      input {
        width: 200px;
      }
    }
  }

  .blockStyle1 {
    padding: 12px var(--spacing-m);
  }

  .blockStyle2 {
    padding: var(--spacing-s) var(--spacing-m);
  }

  .blockTitle {
    display: block;
    font-size: var(--font-14);
    font-weight: 600;
    line-height: var(--spacing-l);
    color: var(--color-text-control-primary-default);
    user-select: none;
  }

  .blockContent {
    position: relative;
    min-height: var(--spacing-l);
    flex-grow: 1;
  }

  .item {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    width: max-content;
  }

  .itemName {
    font-size: var(--font-14);
    line-height: var(--font-16);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }

  .itemBlocked {
    flex-shrink: 0;
    font-size: var(--font-12);
    color: var(--warning-content-default);
    white-space: nowrap;
  }

  .chipText {
    display: block;
    font-size: var(--font-10);
    font-weight: 400;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }
</style>
