<script lang="ts" setup>
  import { getFsRootDisplayName } from '@shared/utils/fs-grouping';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';
  import CustomScrollBar from '@/components/common/custom-scroll-bar.vue';

  const { t } = useI18n();
  const picker = usePickerState();
</script>

<template>
  <nav :class="$style.sidebar">
    <custom-scroll-bar>
      <template
        v-for="category in picker.categories.value"
        :key="category.key"
      >
        <div
          v-if="category.key === 'device' && category.mode === 'single'"
          :class="$style.sectionDivider"
        />
        <div
          v-if="category.mode === 'single'"
          :class="[
            $style.navItem,
            category.roots[0].id.startsWith('system') && $style.systemFolderListItem,
            { [$style.selected]: picker.activeRootId.value === category.roots[0].id },
          ]"
          @click="picker.switchRoot(category.roots[0].id)"
        >
          <ui3n-icon
            :icon="category.roots[0].icon"
            width="16"
            height="16"
            :color="
              picker.activeRootId.value === category.roots[0].id
                ? 'var(--color-icon-control-accent-default)'
                : 'var(--color-icon-control-secondary-default)'
            "
          />
          <span :class="$style.name">{{ t(category.labelKey) }}</span>
        </div>

        <template v-else>
          <div :class="$style.sectionDivider" />
          <div :class="$style.sectionHeader">
            {{ t(category.labelKey) }}
          </div>
          <div
            v-for="root in category.roots"
            :key="root.id"
            :class="[
              $style.navItem,
              root.id.startsWith('system') && $style.systemFolderListItem,
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
            <span :class="$style.name">{{ getFsRootDisplayName(root) }}</span>
          </div>
        </template>
      </template>
    </custom-scroll-bar>
  </nav>
</template>

<style lang="scss" module>
  @use '@shared/styles/fs-sidebar';

  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 7px;
    overflow-y: auto;
  }
</style>
