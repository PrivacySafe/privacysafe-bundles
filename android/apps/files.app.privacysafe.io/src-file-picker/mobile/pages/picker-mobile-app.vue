<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import { Ui3nDialogProvider } from '@v1nt1248/3nclient-lib';
  import filePickerMobileDialog from '@picker/mobile/components/file-picker/file-picker-mobile-dialog.vue';
  import { useInitSetup } from '@picker/common/composables/useInitSetup';
  useInitSetup();
</script>

<template>
  <div :class="$style.app">
    <file-picker-mobile-dialog />
    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  .app {
    --main-toolbar-height: calc(var(--spacing-s) * 9);
    position: fixed;
    inset: 0;
  }
</style>
