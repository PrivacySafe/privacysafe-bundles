<script lang="ts" setup>
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();
  const picker = usePickerState();
</script>

<template>
  <nav :class="$style.sidebar">
    <template
      v-for="category in picker.categories.value"
      :key="category.key"
    >
      <div
        v-if="category.mode === 'single'"
        :class="[$style.navItem, { [$style.active]: picker.activeRootId.value === category.roots[0].id }]"
        @click="picker.switchRoot(category.roots[0].id)"
      >
        <ui3n-icon
          :icon="category.roots[0].icon"
          width="22"
          height="22"
          color="var(--color-icon-control-secondary-default)"
        />
        <span>{{ t(category.labelKey) }}</span>
      </div>

      <template v-else>
        <div :class="$style.sectionDivider" />
        <div :class="$style.sectionHeader">
          {{ t(category.labelKey) }}
        </div>
        <div
          v-for="root in category.roots"
          :key="root.id"
          :class="[$style.navItem, $style.subItem, { [$style.active]: picker.activeRootId.value === root.id }]"
          @click="picker.switchRoot(root.id)"
        >
          <ui3n-icon
            :icon="root.icon"
            width="22"
            height="22"
            color="var(--color-icon-control-secondary-default)"
          />
          <span>{{ root.name }}</span>
        </div>
      </template>
    </template>
  </nav>
</template>

<style lang="scss" module>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 7px;
    overflow-y: auto;
  }

  .sectionDivider {
    height: 1px;
    margin: 8px 8px;
    background-color: var(--color-border-block-primary-default);
  }

  .sectionHeader {
    padding: 4px 12px 6px;
    font-size: var(--font-11);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--color-text-control-secondary-default);
    cursor: default;
    user-select: none;
  }

  .navItem {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--font-13);
    padding: 10px 12px;
    border-radius: 5px;
    cursor: pointer;
    user-select: none;
    color: var(--color-text-control-primary-default);
    transition:
      background-color 0.15s,
      color 0.15s;

    &:hover {
      background-color: color-mix(in srgb, var(--color-bg-control-primary-hover) 30%, transparent);
    }
    &.active {
      background-color: var(--color-bg-control-primary-hover);
    }
  }

  .subItem span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
