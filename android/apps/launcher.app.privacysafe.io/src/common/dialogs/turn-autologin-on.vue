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
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nInput,
    type Ui3nDialogEvent,
    type Ui3nDialogComponentProps,
  } from '@v1nt1248/3nclient-lib';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: string }): void;
  }>();

  const { t } = useI18n();

  const loginPassword = ref('');
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="loginPassword"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.frame">
        <ui3n-input
          v-model="loginPassword"
          type="password"
          :label="t('settings.label.autologin_enter_password')"
          :placeholder="t('settings.placeholder.password')"
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .frame {
    padding: var(--spacing-m) var(--spacing-m) 0 var(--spacing-m);
  }
</style>
