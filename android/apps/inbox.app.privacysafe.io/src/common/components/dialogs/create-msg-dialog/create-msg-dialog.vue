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
  import { ref } from 'vue';
  import { Ui3nAutocomplete, Ui3nButton, Ui3nChip, Ui3nDialog, Ui3nInput, Ui3nHtml } from '@v1nt1248/3nclient-lib';
  import { markSearch } from '@v1nt1248/3nclient-lib/utils';
  import type { CreateMsgDialogProps, CreateMsgDialogEmits } from './types';
  import { useCreateMsg } from './useCreateMsg';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';
  import AttachToOutgoingMessage from '@common/components/attach-to-outgoing-message/attach-to-outgoing-message.vue';
  import TextEditor from '@common/components/text-editor/text-editor.vue';

  const vUi3nHtml = Ui3nHtml;

  const props = defineProps<CreateMsgDialogProps>();
  const emits = defineEmits<CreateMsgDialogEmits>();

  const hasBlockingAttachments = ref(false);

  const {
    t,
    isLoading,
    dialogEl,
    contactList,
    isContactBlocked,
    msgData,
    withoutSave,
    showEditorToolbar,
    isFormDisabled,
    filterContactList,
    getDisplayItem,
    onEditorInit,
    onMsgDataUpdateDebounced,
    removeRecipient,
    updateAttachments,
    toggleEditorToolbarDisplaying,
    msgBodyUpdate,
    discardMsg,
    send,
  } = useCreateMsg({ props, emits });

  /**
   * Esc is the only `cancel` the dialog itself can raise here: its own cancel
   * button is off, and Discard emits one of its own without passing through.
   * Closing is not discarding - the draft stays, as it does for the X button
   * beside it, which raises `close` and which nothing acts on.
   */
  function onDialogAction(value: { event: string; data?: unknown }) {
    emits('action', (value.event === 'cancel' ? { event: 'close' } : value) as never);
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="{ msgData, withoutSave }"
    :class="$style.createMsgDialog"
    @action="onDialogAction"
  >
    <template #body>
      <div
        ref="dialogEl"
        :class="$style.createMsgDialogBody"
      >
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
              @update:model-value="onMsgDataUpdateDebounced"
            >
              <template #item="{ item, query }">
                <div :class="$style.item">
                  <span
                    v-ui3n-html="markSearch(getDisplayItem(item), query || '')"
                    :class="$style.itemName"
                  />

                  <!--
                    Says why the row cannot be picked. The row itself is inert
                    through `item-disabled`; without this mark its being greyed
                    out would be the only clue.
                  -->
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

    <template #actions>
      <div :class="$style.createMsgDialogActions">
        <ui3n-button
          type="custom"
          :color="
            showEditorToolbar
              ? 'var(--color-bg-button-secondary-pressed)'
              : 'var(--color-bg-button-secondary-default)'
          "
          :text-color="
            showEditorToolbar
              ? 'var(--color-text-button-secondary-pressed)'
              : 'var(--color-text-button-secondary-default)'
          "
          :disabled="isLoading"
          @click.stop.prevent="toggleEditorToolbarDisplaying"
        >
          {{ t('msg.create.btn.editor_formating') }}
        </ui3n-button>

        <div :class="$style.createMsgDialogActionsBlock">
          <ui3n-button
            type="secondary"
            :disabled="isLoading"
            @click.stop.prevent="discardMsg"
          >
            {{ t('msg.create.btn.discard') }}
          </ui3n-button>

          <ui3n-button
            :disabled="isFormDisabled || isLoading || hasBlockingAttachments"
            @click.stop.prevent="send"
          >
            {{ t('msg.create.btn.send') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .createMsgDialog {
    --create-dialog-actions-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    border-radius: var(--spacing-m) !important;
  }

  .createMsgDialogBody {
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
  }

  .blockTitle {
    display: block;
    font-size: var(--font-14);
    font-weight: 600;
    line-height: var(--spacing-l);
    color: var(--color-text-control-primary-default);
    user-select: none;
  }

  .blockStyle1 {
    padding: 12px var(--spacing-m);
  }

  .blockStyle2 {
    padding: var(--spacing-s) var(--spacing-m);
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

  .createMsgDialogActions {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;
    height: var(--create-dialog-actions-height);
    border-top: 1px solid var(--color-border-block-primary-default);
    padding: 0 var(--spacing-l);
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 1;
    background-color: var(--color-bg-block-primary-default);
    border-bottom-right-radius: var(--spacing-m);
    border-bottom-left-radius: var(--spacing-m);
  }

  .createMsgDialogActionsBlock {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
