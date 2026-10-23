<script lang="ts" setup>
  import { computed, type ComputedRef, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useNavigation } from '@/composables/useNavigation';
  import { SORTABLE_FIELDS } from './constants';
  import type { ListingEntryExtended, RouteDouble, RouteSingle } from '@shared/types';

  const { t } = useI18n();

  const isMenuOpen = ref(false);

  const {
    activeWindow,
    isSplittedMode,
    window1SortBy,
    window1SortOrder,
    window2SortBy,
    window2SortOrder,
    navigateToRouteSingle,
    navigateToRouteDouble,
  } = useNavigation();

  const sortingBy = computed(() => activeWindow.value === '1' ? window1SortBy.value : window2SortBy.value!) as unknown as ComputedRef<string>;

  const sortingOrder = computed(() => activeWindow.value === '1' ? window1SortOrder.value : window2SortOrder.value!) as unknown as ComputedRef<string>;

  const selectedItem = computed(() => SORTABLE_FIELDS.find(i => i.field === sortingBy.value));

  function changeSort(field: keyof ListingEntryExtended) {
    if (isSplittedMode.value) {
      const query: Partial<RouteDouble['query']> = {
        ...(field !== sortingBy.value && activeWindow.value === '1' && { sortBy: field }),
        ...(field !== sortingBy.value && activeWindow.value === '2' && { sort2By: field }),
        ...(field === sortingBy.value && activeWindow.value === '1' && { sortOrder: sortingOrder.value === 'asc' ? 'desc' : 'asc' }),
        ...(field === sortingBy.value && activeWindow.value === '2' && { sort2Order: sortingOrder.value === 'asc' ? 'desc' : 'asc' }),
      };
      return navigateToRouteDouble({ query });
    }

    const query: Partial<RouteSingle['query']> = {
      ...(field !== sortingBy.value && { sortBy: field }),
      ...(field === sortingBy.value && { sortOrder: sortingOrder.value === 'asc' ? 'desc' : 'asc' }),
    };
    return navigateToRouteSingle({ query });
  }
</script>

<template>
  <ui3n-menu
    v-model="isMenuOpen"
    :offset-x="-4"
    :offset-y="4"
  >
    <ui3n-button
      type="custom"
      color="var(--color-bg-control-secondary-default)"
      text-color="var(--color-text-control-primary-default)"
      :icon="isMenuOpen ? 'round-keyboard-arrow-up': 'round-keyboard-arrow-down'"
      icon-color="var(--color-icon-button-tritery-default)"
      icon-position="right"
      :class="$style.sortingSelector"
    >
      <div :class="$style.sorting">
        <span>{{ t('fs.entity.sorting_text') }}:</span>
        <span>{{ t(selectedItem?.label || '') }}</span>
        <ui3n-icon
          :icon="sortingOrder === 'desc' ? 'round-arrow-downward' : 'round-arrow-upward'"
          width="14"
          height="14"
          color="var(--color-icon-button-tritery-default)"
        />
      </div>
    </ui3n-button>

    <template #menu>
      <div
        v-for="item in SORTABLE_FIELDS"
        :key="item.field"
        :class="[$style.item, item.field === sortingBy && $style.selected]"
        @click="changeSort(item.field)"
      >
        {{ t(item.label) }}

        <ui3n-icon
          v-if="item.field === sortingBy"
          :icon="sortingOrder === 'desc' ? 'round-arrow-downward' : 'round-arrow-upward'"
          width="14"
          height="14"
          color="var(--color-icon-control-accent-default)"
        />
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  .sortingSelector {
    --sorting-selector-width: 140px;

    position: relative;
    justify-content: space-between !important;
    width: var(--sorting-selector-width) !important;
    padding-left: var(--spacing-s) !important;
    font-size: var(--font-11) !important;
  }

  .sorting {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .item {
    display: flex;
    height: var(--spacing-l);
    width: 140px;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    font-size: var(--font-13);
    color: var(--color-text-control-primary-default);
    column-gap: var(--spacing-xs);

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);
      cursor: pointer;
    }
  }

  .selected {
    color: var(--color-text-control-accent-default);
  }
</style>
