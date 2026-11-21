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
<!--
 The phone form of the avatar menu: a drawer over the greyed-out content, the
 same shape as the one in the Contacts app. The avatar here is a picture and
 not a trigger - the drawer is opened by the hamburger in the toolbar.
-->
<script lang="ts" setup>
  import { storeToRefs } from 'pinia';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import ContactIcon from '@main/common/components/contacts/contact-icon.vue';
  import { useAppMenuItems } from '@main/common/composables/useAppMenu';
  import { useAppStore } from '@main/common/store/app.store';
  import type { AppMenuAction } from '~/app.types';

  defineProps<{
    user: string;
  }>();

  const emits = defineEmits<{
    (event: 'close'): void;
    (event: 'action', value: AppMenuAction): void;
  }>();

  const menuItems = useAppMenuItems();
  // Taken from the store rather than passed in: the drawer is the only place on
  // a phone where the version is shown, and a prop for it would have to be
  // threaded through the page that opens the drawer for nothing else.
  const { appVersion } = storeToRefs(useAppStore());

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
          type="outline"
          size="large"
          block
          :icon="item.icon"
          icon-position="left"
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
  @use '@main/common/assets/styles/mixins' as mixins;

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
      user-select: none;
    }
  }
</style>
