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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import CustomScrollBar from '@/components/common/custom-scroll-bar.vue';
  import { useFsStore } from '@/store';
  import { groupStorageFsRoots, getFsFolderLabel } from '@/utils/group-storage-fs-roots';
  import type { RootFsFolderView } from '@shared/types';

  const props = defineProps<{
    modelValue: string;
    availableFsFolders: RootFsFolderView[];
  }>();

  const emits = defineEmits<{
    (event: 'update:modelValue', value: string): void;
  }>();

  const { t, te } = useI18n();

  const { fsFolderList } = storeToRefs(useFsStore());

  const isMenuOpen = ref(false);

  const fsSections = computed(() => {
    const { userFsFolders, fsCategories, ungroupedFsFolders } = groupStorageFsRoots(props.availableFsFolders);
    return [
      { key: 'home', labelKey: '', roots: userFsFolders },
      ...fsCategories,
      { key: 'other', labelKey: '', roots: ungroupedFsFolders },
    ]
      .filter(section => section.roots.length > 0)
      .map(({ key, labelKey, roots }) => ({
        key,
        labelKey,
        roots: roots.map(folder => ({
          id: folder.id,
          label: getFsFolderLabel(folder, labelKey, t, te),
        })),
      }));
  });

  const selectedFsFolderName = computed(() => {
    if (!props.modelValue) {
      return '-';
    }

    const fsFolder = fsFolderList.value.find(f => f.id === props.modelValue);
    const name = fsFolder?.name || '-';
    return te(name) ? t(name) : name;
  });

  function selectItem(id: string) {
    if (id !== props.modelValue) {
      emits('update:modelValue', id);
    }
    isMenuOpen.value = false;
  }
</script>

<template>
  <ui3n-menu
    v-model="isMenuOpen"
    :offset-x="-4"
    :offset-y="4"
    :content-border-radius="16"
    :close-on-click="false"
    :class="$style.fsSystemsMenu"
  >
    <ui3n-button
      type="custom"
      color="var(--color-bg-control-secondary-default)"
      text-color="var(--color-text-control-primary-default)"
      :icon="isMenuOpen ? 'round-keyboard-arrow-up' : 'round-keyboard-arrow-down'"
      icon-color="var(--color-icon-button-tritery-default)"
      icon-position="right"
      :class="$style.fsSystemsSelector"
      :title="selectedFsFolderName"
    >
      {{ selectedFsFolderName }}
    </ui3n-button>

    <template #menu>
      <div :class="$style.menuContent">
        <custom-scroll-bar :class="$style.menuScroll">
          <div>
            <div
              v-for="section in fsSections"
              :key="section.key"
              :class="$style.section"
            >
              <div
                v-if="section.labelKey"
                :class="$style.sectionHeader"
                @click.stop
              >
                {{ t(section.labelKey) }}
              </div>

              <div
                v-for="fsFolder in section.roots"
                :key="fsFolder.id"
                :class="[$style.item, fsFolder.id === modelValue && $style.selected]"
                :title="fsFolder.label"
                @click="selectItem(fsFolder.id)"
              >
                <span :class="$style.itemName">
                  {{ fsFolder.label }}
                </span>
              </div>
            </div>
          </div>
        </custom-scroll-bar>
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  @use '@shared/styles/fs-sidebar';

  .menuContent {
    padding: var(--spacing-xs);
  }

  .menuScroll {
    height: auto;
    max-height: 60vh;
    max-height: round(down, 60vh, 1px);

    & > div:first-child {
      max-height: inherit;
    }
  }

  .section + .section {
    margin-top: var(--spacing-s);
    padding-top: var(--spacing-s);
    border-top: 1px solid var(--color-border-control-secondary-default);
  }

  .fsSystemsMenu {
    max-width: 100%;
  }

  .fsSystemsSelector {
    position: relative;
    justify-content: space-between !important;
    width: max-content !important;
    min-width: min(210px, 100%);
    max-width: min(320px, 100%);
    padding-left: var(--spacing-s) !important;
    font-size: var(--font-11) !important;
    text-align: left;

    & > span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    & > [data-ui3n='icon'] {
      flex-shrink: 0;
    }
  }

  .item {
    display: flex;
    height: var(--spacing-l);
    width: 210px;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    border-radius: 12px;
    font-size: var(--font-13);
    color: var(--color-text-control-primary-default);

    &:hover,
    &.selected {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-primary-hover);
      cursor: pointer;
    }
  }

  .itemName {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
