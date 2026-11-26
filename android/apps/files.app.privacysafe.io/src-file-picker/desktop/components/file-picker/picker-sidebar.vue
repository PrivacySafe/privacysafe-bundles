<script lang="ts" setup>
  import { isSystemRoot } from '@shared/utils/fs-grouping';
  import { getFsFolderLabel } from '@/utils/group-storage-fs-roots';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';
  import CustomScrollBar from '@/components/common/custom-scroll-bar.vue';

  const { t, te } = useI18n();
  const picker = usePickerState();
</script>

<template>
  <nav :class="$style.sidebar">
    <custom-scroll-bar>
      <div
        v-for="category in picker.categories.value"
        :key="category.key"
        :class="{ [$style.listBlock]: category.mode === 'collection' }"
      >
        <div
          v-if="category.mode === 'collection'"
          :class="$style.sectionHeader"
        >
          {{ t(category.labelKey) }}
        </div>
        <div
          v-for="root in category.roots"
          :key="root.id"
          :class="[
            $style.navItem,
            isSystemRoot(root) && $style.systemFolderListItem,
            { [$style.selected]: picker.activeRootId.value === root.id },
          ]"
          @click="picker.switchRoot(root.id)"
        >
          <ui3n-icon
            :icon="root.icon"
            width="16"
            height="16"
            :color="
              picker.activeRootId.value === root.id
                ? 'var(--color-icon-control-accent-default)'
                : 'var(--color-icon-control-secondary-default)'
            "
          />
          <span :class="$style.name">{{ getFsFolderLabel(root, category.labelKey, t, te) }}</span>
        </div>
      </div>
    </custom-scroll-bar>
  </nav>
</template>

<style lang="scss" module>
  @use '@shared/styles/fs-sidebar';

  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--spacing-s) var(--spacing-xs) var(--spacing-s) var(--spacing-s);
    overflow-y: auto;
  }

  .listBlock {
    padding: var(--spacing-s) 0;
    border-top: 1px solid var(--color-border-block-primary-default);
  }
</style>
