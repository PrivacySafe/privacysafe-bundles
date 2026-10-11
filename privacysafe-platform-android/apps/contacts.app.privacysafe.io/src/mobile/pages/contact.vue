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
  import { computed, onBeforeUnmount, ref, watch, type WatchHandle } from 'vue';
  import { useI18n } from 'vue-i18n';
  import cloneDeep from 'lodash/cloneDeep';
  import { Ui3nButton, Ui3nIcon, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { useContact } from '@main/common/composables/use-contact';
  import { useRouting } from '@main/mobile/composables/useRouting';
  import ContactBody from '@main/common/components/contact-content.vue';
  import OwnKeysInfoDialog from '@main/common/components/dialogs/own-keys-info-dialog.vue';
  import ContactKeysInfoDialog from '@main/common/components/dialogs/contact-keys-info-dialog.vue';
  import ShareQrDialog from '@main/common/components/dialogs/share-qr-code-dialog.vue';
  import { EMPTY_CONTACT } from '@main/common/constants';

  const { goToList, goToContact, getEditStateFromRoute } = useRouting();
  const { t } = useI18n();

  const {
    isLoading,
    isUserAddress,
    isContactNew,
    contact,
    contactIdFromURL: contactId,
    contentEl,
    initialContact,
    contactValid,
    contactLetters,
    contactAvatarStyle,
    contactDisplayName,
    rules,
    imageProcessing,
    contactSettings,
    getContactData,
    openChat,
    openInbox,
    canReachOtherApps,
    canShowContactKeys,
    saveContact,
    delContact,
    onFieldUpdate,
    uploadImage,
    deleteImage,
    setUpContactBlocking,
  } = useContact();

  const isOwnKeysInfoOpen = ref(false);
  const isContactKeysInfoOpen = ref(false);
  const isShareQrOpen = ref(false);

  const isEditMode = computed(() => getEditStateFromRoute());

  async function openEditMode() {
    await goToContact(contact.value!.id, { edit: true });
  }

  async function closeEditMode() {
    if (contact.value!.id === EMPTY_CONTACT.id) {
      await goToList();
    } else {
      contact.value = cloneDeep(initialContact.value);
      await goToContact(contact.value!.id, { edit: false });
    }
  }

  function closeKeysInfo() {
    isOwnKeysInfoOpen.value = false;
    isContactKeysInfoOpen.value = false;
  }

  const routeWatching: WatchHandle = watch(
    contactId,
    async () => {
      await getContactData();
      if (contentEl.value) {
        contentEl.value.scrollTop = 0;
      }
    },
    {
      immediate: true,
    },
  );

  onBeforeUnmount(() => {
    routeWatching && routeWatching.stop();
  });
</script>

<template>
  <div :class="$style.contact">
    <div :class="$style.toolbar">
      <div :class="$style.toolbarBlock">
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-color="var(--color-icon-block-primary-default)"
          icon-size="28"
          @click="goToList"
        />

        <ui3n-button
          v-if="!isUserAddress && !isEditMode"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-edit"
          icon-color="var(--color-icon-block-primary-default)"
          icon-size="28"
          @click="openEditMode"
        />

        <ui3n-button
          v-if="!isEditMode"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-chat"
          icon-color="var(--color-icon-button-secondary-default)"
          icon-size="28"
          :disabled="!canReachOtherApps"
          @click="openChat"
        />

        <ui3n-button
          v-if="!isEditMode"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-mail"
          icon-color="var(--color-icon-button-secondary-default)"
          icon-size="28"
          :disabled="!canReachOtherApps"
          @click="openInbox"
        />

        <template v-if="!isEditMode">
          <ui3n-button
            v-if="isUserAddress"
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-key"
            icon-size="28"
            icon-color="var(--color-icon-button-secondary-default)"
            @click="isOwnKeysInfoOpen = true"
          />

          <ui3n-button
            v-if="!isUserAddress"
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-key"
            icon-size="28"
            icon-color="var(--color-icon-button-secondary-default)"
            :disabled="!canShowContactKeys"
            @click="isContactKeysInfoOpen = true"
          />
        </template>

        <template v-if="!isEditMode">
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-qr-code"
            icon-size="28"
            icon-color="var(--color-icon-button-secondary-default)"
            @click="isShareQrOpen = true"
          />
        </template>
      </div>

      <div :class="$style.toolbarBlock">
        <template v-if="isEditMode || isUserAddress">
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-done"
            icon-color="var(--success-content-default)"
            icon-size="28"
            :disabled="!contactValid"
            @click="() => saveContact({})"
          />

          <ui3n-button
            v-if="!isUserAddress"
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-close"
            icon-color="var(--color-icon-block-primary-default)"
            icon-size="28"
            @click="closeEditMode"
          />
        </template>

        <template v-else>
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            :icon="contactSettings.blockUser ? 'outline-account-circle' : 'outline-account-off-circle'"
            icon-size="28"
            icon-color="var(--warning-content-default)"
            :disabled="isLoading"
            @click="
              () =>
                setUpContactBlocking({
                  id: contact!.id,
                  contactName: contact!.name ?? contact!.mail,
                  value: !contactSettings.blockUser,
                })
            "
          />

          <ui3n-button
            v-if="!isUserAddress && !isContactNew"
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="trash-can"
            icon-color="var(--warning-content-default)"
            icon-size="28"
            @click="() => delContact()"
          />
        </template>
      </div>
    </div>
    <div :class="$style.editFormBody">
      <!--<custom-scroll-bar>-->
      <div
        :class="$style.avatar"
        :style="contactAvatarStyle"
      >
        <span v-if="!contact?.avatarImage">{{ contactLetters }}</span>

        <div
          v-if="imageProcessing"
          :class="$style.progress"
        >
          <ui3n-progress-circular
            indeterminate
            size="48"
          />
        </div>

        <ui3n-icon
          v-if="contactSettings.blockUser"
          icon="round-lock"
          color="var(--warning-content-default)"
          size="32"
          :class="$style.banned"
        />
      </div>

      <div :class="$style.avatarBtns">
        <ui3n-button
          v-if="isUserAddress || isEditMode"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="contact?.avatarId ? 'outline-delete' : 'outline-file-upload'"
          icon-size="20"
          :icon-color="
            contact?.avatarId ? 'var(--warning-content-default)' : 'var(--color-icon-block-primary-default)'
          "
          :disabled="imageProcessing"
          v-on="contact?.avatarId ? { click: deleteImage } : { click: uploadImage }"
        />
      </div>

      <div :class="$style.contactBody">
        <contact-body
          v-if="contact"
          :contact="contact"
          :valid="contactValid"
          :rules="rules"
          :is-mobile-form-factor="true"
          :class="!isEditMode && $style.readonly"
          @update:field="onFieldUpdate"
          @update:valid="contactValid = $event"
        />
      </div>
      <!--</custom-scroll-bar>-->
    </div>
    <div
      v-if="isOwnKeysInfoOpen || isContactKeysInfoOpen"
      :class="$style.keysInfo"
    >
      <div :class="$style.keysInfoToolbar">
        <ui3n-button
          :class="$style.closeBtn"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-color="var(--color-icon-block-primary-default)"
          @click="closeKeysInfo"
        />

        <span v-if="isOwnKeysInfoOpen">{{ t('contact.dialog.title.own-keys') }}</span>
        <span v-if="isContactKeysInfoOpen">{{
          t('contact.dialog.title.contact-keys', { contact: contactDisplayName })
        }}</span>
      </div>

      <div :class="$style.keysInfoBody">
        <own-keys-info-dialog
          v-if="isOwnKeysInfoOpen"
          :dialog-props="{
            cssStyle: { maxWidth: '100%', width: '100%' },
            confirmButton: false,
            cancelButton: false,
          }"
          :class="$style.keyInfoDialog"
        />

        <contact-keys-info-dialog
          v-if="isContactKeysInfoOpen"
          :contact-addr="contact!.mail"
          :dialog-props="{
            cssStyle: { maxWidth: '100%', width: '100%' },
            confirmButton: false,
            cancelButton: false,
          }"
          :class="$style.keyInfoDialog"
        />
      </div>
    </div>
    <div
      v-if="isShareQrOpen"
      :class="$style.keysInfo"
    >
      <div :class="$style.keysInfoToolbar">
        <ui3n-button
          :class="$style.closeBtn"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-color="var(--color-icon-block-primary-default)"
          @click="isShareQrOpen = false"
        />
      </div>

      <div :class="$style.keysInfoBody">
        <share-qr-dialog
          v-if="isShareQrOpen"
          :contact-data="contact"
          :dialog-props="{
            cssStyle: { maxWidth: '100%', width: '100%' },
            title: 'Sharing',
            confirmButton: false,
            cancelButton: false,
          }"
          :class="$style.keyInfoDialog"
        />
      </div>
    </div>

    <div
      v-if="isLoading"
      :class="$style.loader"
    >
      <ui3n-progress-circular
        indeterminate
        size="48"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .contact {
    --contact-toolbar-height: 64px;
    --contact-avatar-size: 160px;

    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m) var(--spacing-s) var(--spacing-m) var(--spacing-m);
    background-color: var(--color-bg-block-primary-default);
  }

  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: var(--contact-toolbar-height);
    background-color: var(--color-bg-block-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    z-index: 5;
    padding: 0 var(--spacing-s);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .toolbarBlock {
    --ui3n-button-icon-size-regular: 40px;
    --ui3n-button-height-regular: 40px;

    display: flex;
    justify-content: flex-start;
    align-items: center;
  }

  .avatar {
    position: relative;
    width: var(--contact-avatar-size);
    height: var(--contact-avatar-size);
    border-radius: 50%;
    user-select: none;
    display: flex;
    justify-content: center;
    align-items: center;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
    margin: 0 auto var(--spacing-s) auto;
    color: var(--color-text-avatar-primary-default);
    -webkit-font-smoothing: antialiased;
    font-size: 50px;
    font-weight: 500;
    cursor: pointer;

    .banned {
      position: absolute;
      top: 0;
      right: 0;
    }
  }

  .progress {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1;
  }

  .avatarBtns {
    display: flex;
    width: 100%;
    justify-content: center;
    align-items: center;
    margin-bottom: var(--spacing-s);

    button {
      border: 1px solid var(--color-border-block-primary-default);
    }
  }

  .contactBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--contact-avatar-size) - var(--spacing-xxl));
  }

  .readonly {
    pointer-events: none;
    cursor: default;
  }

  .keysInfo {
    position: fixed;
    inset: 0;
    z-index: 20;
    background-color: var(--color-bg-block-primary-default);
  }

  .keysInfoToolbar {
    display: flex;
    width: 100%;
    height: var(--spacing-xxl);
    padding: 0 var(--spacing-s) 0 var(--spacing-xxl);
    justify-content: flex-start;
    align-items: center;
    font-size: var(--font-14);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .closeBtn {
    position: absolute !important;
    top: var(--spacing-s);
    left: var(--spacing-s);
  }

  .keysInfoBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--spacing-xxl) - var(--spacing-m));
    overflow-y: auto;

    & > div {
      max-height: 100% !important;
    }

    .keyInfoDialog {
      border-radius: 0 !important;
      box-shadow: none !important;

      & > button {
        display: none !important;
      }
    }
  }

  .editFormBody {
    overflow-y: auto;
    height: 100dvh;
  }

  .loader {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgb(0, 0, 0, 0.15);
  }
</style>
