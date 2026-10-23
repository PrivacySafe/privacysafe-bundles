<!--
 Copyright (C) 2026 3NSoft Inc.

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
<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Nullable, Ui3nButton, Ui3nIcon, Ui3nClickOutside } from '@v1nt1248/3nclient-lib';
  import { DEFAULT_GROUPS } from '@shared/constants';
  import type { TreasureGroup } from '@shared/@types';

  const vUi3nClickOutside = Ui3nClickOutside;

  const props = defineProps<{
    groups: TreasureGroup[];
    selectedGroup: string;
  }>();
  const emits = defineEmits<{
    (event: 'create:treasure'): void;
    (event: 'edit:group', value: string): void;
    (event: 'select', value: string): void;
  }>();

  const { t } = useI18n();

  const groupActionsMenuProps = ref<{
    open: boolean;
    groupId: Nullable<string>;
  }>({
    open: false,
    groupId: null,
  });

  function resetGroupMenuData() {
    groupActionsMenuProps.value = {
      open: false,
      groupId: null,
    };
  }

  function selectActionWithGroup(action: string, groupId: string) {
    switch (action) {
      case 'edit': {
        emits('edit:group', groupId);
        resetGroupMenuData();
      }

      // no default
    }
  }

  function onGroupClick(ev: MouseEvent, groupId: string) {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    const selectedGroup = props.groups.find(gr => gr.id === groupId);
    if (selectedGroup) {
      groupActionsMenuProps.value = {
        open: true,
        groupId: selectedGroup.id,
      };
    }
  }
</script>

<template>
  <div :class="$style.groups">
    <div :class="$style.actions">
      <ui3n-button
        icon="round-plus"
        icon-position="left"
        icon-color="var(--color-icon-button-primary-default)"
        icon-size="16"
        @click.stop.prevent="emits('create:treasure')"
      >
        {{ t('list.create') }}
      </ui3n-button>
    </div>

    <div :class="$style.list">
      <template
        v-for="group in DEFAULT_GROUPS"
        :key="group.id"
      >
        <div
          :class="[
            $style.filter,
            ((!group.id && !selectedGroup) || group.id === selectedGroup) && $style.filterSelected,
          ]"
          @click.stop.prevent="emits('select', group.id)"
        >
          <ui3n-icon
            :icon="group.icon"
            :color="
              (!group.id && !selectedGroup) || group.id === selectedGroup
                ? 'var(--color-icon-control-accent-default)'
                : 'var(--color-icon-control-secondary-default)'
            "
          />
          <span>{{ t(group.title) }}</span>
        </div>
      </template>

      <div
        v-for="gr in groups"
        :id="`group-${gr.id}`"
        :key="gr.id"
        :class="[$style.filter, selectedGroup === gr.id && $style.filterSelected]"
        @click="emits('select', gr.id)"
        @click.right="(ev: MouseEvent) => onGroupClick(ev, gr.id)"
      >
        <ui3n-icon
          icon="group"
          :color="
            selectedGroup === gr.id
              ? 'var(--color-icon-control-accent-default)'
              : 'var(--color-icon-control-secondary-default)'
          "
        />
        <span>{{ gr.name }}</span>
      </div>
    </div>

    <teleport
      v-if="groupActionsMenuProps.groupId"
      :disabled="!groupActionsMenuProps.open"
      :to="`#group-${groupActionsMenuProps.groupId}`"
    >
      <div
        v-ui3n-click-outside="() => resetGroupMenuData()"
        :class="$style.groupMenu"
      >
        <div
          :class="$style.groupMenuItem"
          @click.stop.prevent="selectActionWithGroup('edit', groupActionsMenuProps.groupId)"
        >
          Edit
        </div>
      </div>
    </teleport>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .groups {
    --groups-actions-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;

    .actions {
      display: flex;
      width: 100%;
      height: var(--groups-actions-height);
      justify-content: center;
      align-items: center;
    }

    .list {
      display: flex;
      width: 100%;
      height: calc(100% - var(--groups-actions-height));
      padding: 0 var(--spacing-s) var(--spacing-s) var(--spacing-s);
      flex-direction: column;
      justify-content: flex-start;
      align-items: stretch;
      row-gap: 2px;
      overflow-y: auto;

      .filter {
        position: relative;
        display: flex;
        width: 100%;
        height: 36px;
        border-radius: var(--spacing-s);
        padding: 0 var(--spacing-s);
        justify-content: flex-start;
        align-items: center;
        column-gap: var(--spacing-s);
        user-select: none;

        &.filterSelected {
          background-color: var(--color-bg-control-primary-hover);
        }

        &:hover {
          background-color: var(--color-bg-control-primary-hover);

          span {
            color: var(--color-text-control-primary-hover);
          }

          div {
            color: var(--color-icon-control-accent-default);
          }
        }

        span {
          display: block;
          width: 100%;
          font-style: var(--font-13);
          font-weight: 500;
          color: var(--color-text-control-primary-default);
          cursor: pointer;

          @include mixins.text-overflow-ellipsis();
        }
      }
    }

    .groupMenu {
      position: absolute;
      width: fit-content;
      padding: var(--spacing-xs);
      border-radius: var(--spacing-xs);
      background-color: var(--color-bg-control-secondary-default);
      z-index: 100;
      top: calc(100% - var(--spacing-s));
      border: 1px solid var(--color-border-block-primary-default);
      @include mixins.block-shadow();

      .groupMenuItem {
        position: relative;
        width: fit-content;
        min-width: 120px;
        height: var(--spacing-ml);
        display: flex;
        justify-content: flex-start;
        align-items: center;
        font-size: var(--font-13);
        font-weight: 400;
        color: var(--color-text-control-primary-default);

        &:hover {
          cursor: pointer;
          background-color: var(--color-bg-control-primary-hover);
        }
      }
    }
  }
</style>
