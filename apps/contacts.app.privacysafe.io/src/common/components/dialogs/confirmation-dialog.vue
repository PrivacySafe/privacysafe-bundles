<!--
 Copyright (C) 2020 - 2024 3NSoft Inc.

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
import { Ui3nHtml, Ui3nDialog, type Ui3nDialogComponentProps } from '@v1nt1248/3nclient-lib';

defineProps<{
  dialogText: string;
  additionalDialogText?: string;
  dialogProps?: Ui3nDialogComponentProps<boolean>;
}>();

const vUi3nHtml = Ui3nHtml;
</script>

<template>
  <ui3n-dialog v-bind="dialogProps">
    <template #body>
      <div :class="$style.confirmationDialog">
        <div v-ui3n-html="dialogText" />
        <div v-if="additionalDialogText">
          {{ additionalDialogText }}
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
.confirmationDialog {
  font-size: var(--font-14);
  font-weight: 400;
  color: var(--color-text-block-primary-default);
  text-align: center;
  padding: var(--spacing-ml) var(--spacing-m) var(--spacing-s);
}
</style>
