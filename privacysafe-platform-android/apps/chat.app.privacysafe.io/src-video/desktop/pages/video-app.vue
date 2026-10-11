<!--
 Copyright (C) 2024 3NSoft Inc.

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
import { onBeforeMount, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { Ui3nDialogProvider } from '@v1nt1248/3nclient-lib';
import { useAppStore } from '@video/common/store/app.store';
import { useThemeSync } from '@main/common/composables/useThemeSync';
import { initializationServices } from '@video/common/services/service-provider';

const appStore = useAppStore();
const { initialize, stopWatching } = appStore;
const { colorTheme } = storeToRefs(appStore);

useThemeSync(colorTheme);

onBeforeMount(async () => {
  try {
    await initialize();
    await initializationServices();
  } catch (e) {
    console.error('ON_BEFORE_MOUNT ERROR: ', e);
    throw e;
  }
});

onBeforeUnmount(() => {
  stopWatching();
});
</script>

<template>
  <router-view />
  <ui3n-dialog-provider />
</template>
