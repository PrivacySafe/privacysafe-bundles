<script lang="ts" setup>
  import { computed, type ComputedRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRouter, useRoute } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { useFoldersStore, useMessagesStore } from '@common/store';
  import { useAppMenuItems } from '@common/composables/useAppMenu';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';
  import { Ui3nBadge, Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import type { AppMenuAction, MailFolder } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';
  import size from 'lodash/size';
  import get from 'lodash/get';

  defineProps<{
    appVersion: string;
    user: string;
    connectivityStatusText: string;
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
    (event: 'action', value: AppMenuAction): void;
  }>();

  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const { systemFolders } = storeToRefs(useFoldersStore());
  const { messagesByFolders } = storeToRefs(useMessagesStore());

  const currentFolderId = computed(() => route.params?.folderId) as ComputedRef<string>;

  function getBadgeText(folder: MailFolder): number {
    if (folder.id === SYSTEM_FOLDERS.outbox || folder.id === SYSTEM_FOLDERS.draft) {
      return size(get(messagesByFolders.value, [folder.id, 'data'], []));
    }

    return get(messagesByFolders.value, [folder.id, 'unread'], 0);
  }

  const menuItems = useAppMenuItems();

  async function goToFolder(folder: MailFolder) {
    await router.push({ name: 'folder', params: { folderId: folder.id } });
    emits('close');
  }

  /**
   * The drawer is closed BEFORE the action is passed on: every action here opens
   * a dialog, and leaving the drawer up would put it behind the greyed-out panel
   * this menu lays over the content.
   */
  function onMenuItemClick(id: AppMenuAction) {
    emits('close');
    emits('action', id);
  }
</script>

<template>
  <div :class="$style.appMenu">
    <div :class="$style.appMenuHeader">
      <contact-icon
        :size="40"
        :name="user"
        readonly
      />

      <div :class="$style.info">
        <div :class="$style.user">
          {{ user }}
        </div>

        <div :class="$style.status">
          {{ t('app.status.label') }}:
          <span :class="connectivityStatusText === 'app.status.connected.online' && $style.ok">
            {{ t(connectivityStatusText) }}
          </span>
        </div>
      </div>
    </div>

    <div :class="$style.appMenuBody">
      <template
        v-for="systemFolder in systemFolders"
        :key="systemFolder.id"
      >
        <div
          tabindex="1"
          :class="[$style.systemFolder, systemFolder.id === currentFolderId && $style.systemFolderSelected]"
          @click="goToFolder(systemFolder)"
        >
          <ui3n-icon
            :class="$style.folderIcon"
            :icon="systemFolder.icon || 'round-folder'"
            :color="systemFolder.iconColor || 'var(--color-icon-control-secondary-default)'"
          />

          <span :class="$style.folderName">{{ systemFolder.name }}</span>

          <ui3n-badge
            v-if="getBadgeText(systemFolder)"
            :value="getBadgeText(systemFolder)"
            :class="$style.folderBadge"
          />
        </div>
      </template>

      <div :class="$style.actions">
        <ui3n-button
          v-for="item in menuItems"
          :key="item.id"
          type="outline"
          size="large"
          block
          :icon="item.icon"
          icon-position="left"
          :icon-color="item.isAccent ? 'var(--warning-content-default)' : 'var(--color-icon-control-accent-default)'"
          :class="item.isAccent && $style.accentBtn"
          @click="onMenuItemClick(item.id)"
        >
          {{ item.label }}
        </ui3n-button>

        <div :class="$style.appInfo">
          v {{ appVersion }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .appMenu {
    --app-menu-header-heigh: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-primary-default);
  }

  .appMenuHeader {
    display: flex;
    width: 100%;
    height: var(--app-menu-header-heigh);
    padding-left: var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .info {
    position: relative;
    width: calc(100% - 44px);
    color: var(--color-text-control-primary-default);
  }

  .user {
    font-size: var(--font-14);
    font-weight: 700;
    line-height: var(--font-18);
    @include mixins.text-overflow-ellipsis();
  }

  .status {
    font-size: var(--font-12);
    font-weight: 600;
    line-height: var(--font-16);
  }

  .ok {
    color: var(--success-content-default);
  }

  .appMenuBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--app-menu-header-heigh));
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--spacing-m) 0 216px;

    .appInfo {
      position: relative;
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: var(--font-16);
      font-weight: 500;
      line-height: 1;
      color: var(--color-text-control-secondary-default);
    }
  }

  .actions {
    position: absolute;
    left: var(--spacing-m);
    width: calc(100% - var(--spacing-l));
    bottom: var(--spacing-m);
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
  }

  .accentBtn {
    --ui3n-button-text-color: var(--warning-content-default);

    &:hover {
      background-color: var(--warning-fill-hover);
    }
  }

  .systemFolder {
    position: relative;
    display: flex;
    width: calc(100% - var(--spacing-m));
    height: 36px;
    border-radius: var(--spacing-s);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s) 0 var(--spacing-l);
    cursor: pointer;
    margin: 0 var(--spacing-s) var(--spacing-xs) var(--spacing-s);

    .folderIcon {
      position: absolute;
      left: var(--spacing-s);
      top: 10px;
    }

    .folderName {
      font-size: var(--font-13);
      font-weight: 600;
      line-height: var(--font-16);
      color: var(--color-text-control-primary-default);
    }

    .folderBadge {
      min-width: 20px;
    }

    &.systemFolderSelected {
      background-color: var(--color-bg-control-primary-hover);

      & > div {
        color: var(--color-icon-control-accent-default) !important;
      }
    }
  }
</style>
