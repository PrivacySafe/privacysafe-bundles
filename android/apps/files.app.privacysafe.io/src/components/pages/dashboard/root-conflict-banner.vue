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
<script setup lang="ts">
  import { computed, defineAsyncComponent, inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { VUEBUS_KEY, VueBusPlugin, DIALOGS_KEY, DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useFsStore } from '@/store';
  import type { AppGlobalEvents } from '@shared/types';

  const props = defineProps<{
    folderType: 'root' | 'trash';
  }>();

  const { t } = useI18n();
  const { $emitter } = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { $openDialog } = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const fsStore = useFsStore();

  const folder = computed(() => props.folderType === 'root' ? '' : fsStore.trashFolderName!);

  async function openResolveDialog() {
    const component = defineAsyncComponent(() => import('@/components/dialogs/resolve-conflicts-dialog/resolve-conflicts-dialog.vue'));

    await $openDialog(component, {
      paths: [folder.value],
      dialogProps: {
        title: '',
        width: 960,
        cssStyle: { borderRadius: '24px' },
        contentCssStyle: { borderRadius: '24px' },
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });
    $emitter.emit('refresh:data', { path: folder.value, withoutVerify: true });
  }
</script>

<template>
  <div :class="$style.rootConflictBanner">
    <ui3n-icon
      icon="round-warning"
      :size="16"
      color="var(--color-icon-control-warning-default)"
    />

    <span :class="$style.text">
      {{ folderType === 'root' ? t('folder_banner.text.resolve_root') : t('folder_banner.text.resolve_trash') }}
    </span>

    <ui3n-button
      type="secondary"
      size="small"
      @click.stop.prevent="openResolveDialog"
    >
      {{ t('app.resolve.text') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .rootConflictBanner {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    background-color: var(--warning-fill-default);
  }

  .text {
    font-size: var(--font-12);
    font-weight: 400;
    color: var(--warning-content-default);
  }
</style>
