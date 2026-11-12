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
  import { computed, inject, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import debounce from 'lodash/debounce';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nIcon, Ui3nResize, Ui3nRipple, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { Nullable } from '@v1nt1248/3nclient-lib';
  import { useNavigation } from '@/composables/useNavigation';
  import { useFsStore } from '@/store';
  import type { AppGlobalEvents } from '@shared/types';
  import { getFsRootDisplayName } from '@shared/utils/fs-grouping';
  import LinkBadge from '@/components/common/link-badge/link-badge.vue';

  const vUi3nResize = Ui3nResize;
  const vUi3nRipple = Ui3nRipple;

  const props = defineProps<{
    currentFsFolder: string;
    path: string;
  }>();

  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { t } = useI18n();

  const { isSplittedMode, activeWindow, navigateToRouteSingle, navigateToRouteDouble } = useNavigation();

  const { fsFolderList, folderLocations } = storeToRefs(useFsStore());

  const wrapElement = ref<Nullable<HTMLDivElement>>(null);
  const pathElement = ref<Nullable<HTMLDivElement>>(null);

  const showScrollBtns = ref(false);
  const childElements = ref<HTMLCollection | null>(null);
  const currentChildIndex = ref(0);
  const pathOffsetX = ref(0);

  const rootFolder = computed(() => fsFolderList.value.find(f => f.id === props.currentFsFolder));

  const rootFolderName = computed(() => {
    if (!rootFolder.value) {
      return '';
    }

    return t(getFsRootDisplayName(rootFolder.value)) || 'Root';
  });

  /*
   The breadcrumbs show the path the user went through, links included; a link
   is marked. The location's segments include the root folder's base path, so
   the last ones belong to the shown path.
  */
  const linkFlags = computed(() => {
    const location = folderLocations.value[isSplittedMode.value ? activeWindow.value : '1'];
    if (!location || location.rootFolderId !== props.currentFsFolder) {
      return [] as boolean[];
    }
    const count = props.path ? props.path.split('/').length : 0;
    return location.segments.slice(-count || location.segments.length).map(s => s.isLink);
  });

  const pathItems = computed(() => {
    if (props.path) {
      const parts = props.path.split('/');
      return parts.map((item, index) => ({
        id: index,
        name: item,
        isLink: linkFlags.value.length === parts.length ? linkFlags.value[index] : false,
      }));
    }

    return [];
  });

  const pathOffsetXValue = computed(() => `${pathOffsetX.value}px`);
  const showScrollLeftBtn = computed(() => currentChildIndex.value !== 0);
  const showScrollRightBtn = ref(true);

  function checkAbilityToShowRightBtn() {
    showScrollBtns.value =
      pathElement.value && wrapElement.value
        ? pathElement.value!.offsetWidth > wrapElement.value!.offsetWidth
        : false;
    childElements.value = pathElement.value ? pathElement.value.children : ([] as unknown as HTMLCollection);

    const rectWrapElement = wrapElement.value?.getBoundingClientRect();
    if (rectWrapElement) {
      showScrollRightBtn.value = !(rectWrapElement.width > pathElement.value!.offsetWidth + pathOffsetX.value);
    }
  }

  const checkAbilityToShowRightBtnDebounced = debounce(checkAbilityToShowRightBtn, 300);

  function shiftLeft() {
    const el = childElements.value![currentChildIndex.value] as HTMLElement;
    pathOffsetX.value -= el.offsetWidth;
    currentChildIndex.value += 1;
    checkAbilityToShowRightBtn();
  }

  function shiftRight() {
    if (currentChildIndex.value === 1) {
      pathOffsetX.value = 0;
      currentChildIndex.value = 0;
    } else {
      currentChildIndex.value -= 1;
      const el = childElements.value![currentChildIndex.value] as HTMLElement;
      pathOffsetX.value += el.offsetWidth;
    }
    checkAbilityToShowRightBtn();
  }

  function goToPath(path: string) {
    bus.$emitter.emit('click:breadcrumb', void 0);
    if (isSplittedMode.value) {
      return navigateToRouteDouble({
        params: {
          ...(activeWindow.value === '1' && {
            rootFolderId: props.currentFsFolder,
          }),
          ...(activeWindow.value === '2' && {
            rootFolder2Id: props.currentFsFolder,
          }),
        },
        query: {
          ...(activeWindow.value === '1' && { path }),
          ...(activeWindow.value === '2' && { path2: path }),
        },
      });
    }

    return navigateToRouteSingle({
      params: { rootFolderId: props.currentFsFolder },
      query: { path },
    });
  }

  function goToFolder(index: number) {
    if (index === size(pathItems.value) - 1) {
      return;
    }

    const path = pathItems.value
      .slice(0, index + 1)
      .map(i => i.name)
      .join('/');
    goToPath(path);
  }

  watch(
    showScrollBtns,
    (val, oVal) => {
      if (val !== oVal && !val) {
        pathOffsetX.value = 0;
        currentChildIndex.value = 0;
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div
    ref="wrapElement"
    :class="$style.folderPath"
  >
    <div
      ref="pathElement"
      v-ui3n-resize="checkAbilityToShowRightBtnDebounced"
      :class="$style.path"
    >
      <span
        :class="[$style.item, isEmpty(pathItems) && $style.disabled]"
        @click.stop.prevent="goToPath('')"
      >
        {{ rootFolderName }}
      </span>

      <span
        v-for="(item, index) in pathItems"
        :key="item.id"
        :class="[$style.item, index === size(pathItems) - 1 && $style.disabled]"
        @click.stop.prevent="goToFolder(index)"
      >
        <span :class="$style.itemDelimiter">/</span>

        <link-badge
          :is-link="item.isLink"
          placement="inline"
        >
          <span>{{ item.name }}</span>
        </link-badge>
      </span>
    </div>

    <div
      v-if="showScrollBtns && showScrollLeftBtn"
      v-ui3n-ripple
      :class="$style.btnLeft"
      @click.stop.prevent="shiftRight"
    >
      <ui3n-tooltip
        :content="t('dashboard.toolbar.action.shift_path_right')"
        placement="top"
        position-strategy="fixed"
      >
        <ui3n-icon
          icon="round-keyboard-arrow-left"
          width="24"
          height="24"
        />
      </ui3n-tooltip>
    </div>

    <div
      v-if="showScrollBtns && showScrollRightBtn"
      v-ui3n-ripple
      :class="$style.btnRight"
      @click.stop.prevent="shiftLeft"
    >
      <ui3n-tooltip
        :content="t('dashboard.toolbar.action.shift_path_left')"
        placement="top"
        position-strategy="fixed"
      >
        <ui3n-icon
          icon="round-keyboard-arrow-right"
          width="24"
          height="24"
        />
      </ui3n-tooltip>
    </div>
  </div>
</template>

<style lang="scss" module>
  .folderPath {
    position: relative;
    width: 100%;
    height: 100%;
    padding: 0 var(--spacing-m);
    background-color: var(--color-bg-block-primary-default);
    overflow: hidden;
  }

  .path {
    position: relative;
    width: max-content;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    transition: all 0.2s ease-in-out;
    left: v-bind(pathOffsetXValue);
    font-size: var(--font-16);
    font-weight: 400;
    color: var(--color-text-control-primary-default);

    a {
      text-decoration: none;
      color: var(--color-text-control-primary-default);

      &:hover {
        color: var(--color-text-control-accent-default);
      }
    }
  }

  .item {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    cursor: pointer;
    padding-right: var(--spacing-xs);

    &:hover {
      color: var(--color-text-control-accent-default);
    }
  }

  .itemDelimiter {
    color: var(--color-text-control-accent-default);
  }

  .btnLeft,
  .btnRight {
    position: absolute;
    top: 12px;
    height: 40px;
    width: 80px;
    z-index: 1;
    display: flex;
    align-items: center;
    cursor: pointer;

    &:hover {
      & > div {
        color: var(--color-icon-button-secondary-default) !important;
      }
    }
  }

  .btnLeft {
    left: 0;
    padding-left: 12px;
    justify-content: flex-start;
    background: linear-gradient(to right, var(--color-bg-block-primary-default) 50%, transparent);
  }

  .btnRight {
    right: 0;
    padding-right: 12px;
    justify-content: flex-end;
    background: linear-gradient(to left, var(--color-bg-block-primary-default) 50%, transparent);
  }

  .disabled {
    cursor: default;
    pointer-events: none;
  }
</style>
