<script lang="ts" setup>
  import { nextTick, ref, watch } from 'vue';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();
  const picker = usePickerState();

  const tabsNav = ref<HTMLElement | null>(null);

  // Keeps the active tab visible when it changes from code, not just taps —
  // e.g. usePickerHistory's popstate handler calling switchRoot() while the
  // strip is scrolled away from that tab. 'nearest' avoids re-centering on
  // every switch when the tab's already fully visible (less jumpy than
  // 'center' for a horizontal strip the user is actively swiping).
  watch(
    () => picker.activeRootId.value,
    async id => {
      if (!id) {
        return;
      }
      // Ensure the (possibly newly rendered) tab exists in the DOM.
      await nextTick();
      const el = tabsNav.value?.querySelector<HTMLElement>(`[data-root-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    },
  );
</script>

<template>
  <nav
    ref="tabsNav"
    :class="$style.tabs"
  >
    <template
      v-for="category in picker.categories.value"
      :key="category.key"
    >
      <button
        v-if="category.mode === 'single'"
        :data-root-id="category.roots[0].id"
        :class="[$style.tab, { [$style.active]: picker.activeRootId.value === category.roots[0].id }]"
        @click="picker.switchRoot(category.roots[0].id)"
      >
        {{ t(category.labelKey) }}
      </button>

      <template v-else>
        <span :class="$style.sectionLabel">{{ t(category.labelKey) }}</span>
        <button
          v-for="root in category.roots"
          :key="root.id"
          :data-root-id="root.id"
          :class="[$style.tab, { [$style.active]: picker.activeRootId.value === root.id }]"
          @click="picker.switchRoot(root.id)"
        >
          {{ root.name }}
        </button>
      </template>
    </template>
  </nav>
</template>

<style lang="scss" module>
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    white-space: nowrap;
    padding: 0 8px;
    border-bottom: 1px solid var(--color-border-block-primary-default);
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .tab {
    flex-shrink: 0;
    padding: 10px 12px;
    background: none;
    border: none;
    font-size: var(--font-14);
    color: var(--color-text-control-secondary-default);
    cursor: pointer;

    &.active {
      color: var(--color-text-block-accent-default);
      font-weight: 600;
      border-bottom: 2px solid var(--color-text-block-accent-default);
    }
  }

  .sectionLabel {
    flex-shrink: 0;
    padding: 10px 6px 10px 14px;
    margin-left: 4px;
    border-left: 1px solid var(--color-border-block-primary-default);
    font-size: var(--font-11);
    color: var(--color-text-control-secondary-default);
    opacity: 0.75;
  }
</style>
