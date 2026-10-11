<script lang="ts" setup>
  import { computed, onMounted } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import ContactIcon from '@main/common/components/contact-icon.vue';
  import type { AppMenuAction } from '@main/types';
  import { useTutorialStore } from '@main/common/store/tutorial.store';

  defineProps<{
    user: string;
  }>();

  const emits = defineEmits<{
    (event: 'close'): void;
    (event: 'action', value: AppMenuAction): void;
  }>();

  const { t } = useI18n();
  const tutorialStore = useTutorialStore();

  const menuItems = computed<{ id: AppMenuAction; icon: string; label: string }[]>(() => [
    { id: 'tutorial', icon: 'book-open-blank-variant', label: t('app.menu.tutorial') },
    { id: 'make-backup', icon: 'outline-file-download', label: t('app.menu.makeBackup') },
    { id: 'upload-backup', icon: 'outline-file-upload', label: t('app.menu.uploadBackup') },
    { id: 'exit', icon: 'round-logout', label: t('app.menu.exit') },
  ]);

  /**
   * The drawer is closed BEFORE the action is passed on: every action here opens
   * a dialog, and leaving the drawer up would put it behind the greyed-out panel
   * this menu lays over the content.
   */
  function onMenuItemClick(id: AppMenuAction) {
    emits('close');
    emits('action', id);
  }

  onMounted(() => {
    void tutorialStore.checkAndRunSteps();
  });
</script>

<template>
  <div :class="$style.appMenu">
    <div :class="$style.appMenuHeader">
      <contact-icon
        :size="32"
        :name="user"
        readonly
      />

      <div :class="$style.info">
        <div :class="$style.user">
          {{ user }}
        </div>
      </div>
    </div>

    <div :class="$style.appMenuBody">
      <div :class="$style.actions">
        <ui3n-button
          v-for="item in menuItems"
          :key="item.id"
          :data-tutorial="item.id"
          type="outline"
          size="large"
          block
          :icon="item.icon"
          icon-position="left"
          icon-color="var(--color-icon-control-accent-default)"
          @click="onMenuItemClick(item.id)"
        >
          {{ item.label }}
        </ui3n-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins' as mixins;

  .appMenu {
    --app-menu-header-heigh: 48px;

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
    line-height: var(--font-16);
    @include mixins.text-overflow-ellipsis();
  }

  .status {
    font-size: var(--font-12);
    font-weight: 600;
    line-height: var(--font-14);
  }

  .appMenuBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--app-menu-header-heigh));
    overflow: hidden;
    padding: var(--spacing-m) 0 64px;
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
</style>
