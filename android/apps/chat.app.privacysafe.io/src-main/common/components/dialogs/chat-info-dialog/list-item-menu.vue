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
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon, Ui3nClickOutside as vUi3nClickOutside } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    isOpen?: boolean;
    listItem: { contactId: string; mail: string; isAdmin: boolean };
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
    (
      event: 'do',
      value: { action: 'make:admin' | 'remove:admin'; user: { contactId: string; mail: string } },
    ): void;
  }>();

  const { t } = useI18n();

  function setAdminFlag() {
    const { contactId, mail, isAdmin } = props.listItem;

    emits('do', {
      action: isAdmin ? 'remove:admin' : 'make:admin',
      user: { contactId, mail },
    });
    emits('close');
  }
</script>

<template>
  <div
    v-if="isOpen"
    v-ui3n-click-outside="() => emits('close')"
    :class="$style.listItemMenu"
  >
    <div
      :class="$style.menuItem"
      @click.stop.prevent="setAdminFlag"
    >
      <ui3n-icon :icon="listItem.isAdmin ? 'outline-remove-moderator' : 'outline-add-moderator'" />

      <span>
        {{ t(listItem.isAdmin ? 'chat.info.user.menu.remove_admin' : 'chat.info.user.menu.make_admin') }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" module>
  .listItemMenu {
    position: absolute;
    left: 48px;
    top: 32px;
    width: fit-content;
    padding: var(--spacing-xs);
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-xs);
    box-shadow:
      0 1px 1px 0 var(--shadow-close),
      0 1px 3px 0 var(--shadow-far);
    z-index: 50;
  }

  .menuItem {
    display: flex;
    height: var(--spacing-l);
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    column-gap: var(--spacing-s);

    span {
      font-size: var(--font-13);
      font-weight: 500;
      color: var(--color-text-control-primary-default);
    }

    &:hover {
      background-color: var(--color-bg-control-secondary-hover);
    }
  }
</style>
