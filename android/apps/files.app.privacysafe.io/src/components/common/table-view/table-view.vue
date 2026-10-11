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
  import {
    computed,
    type ComputedRef,
    defineAsyncComponent,
    inject,
    onBeforeMount,
    onBeforeUnmount,
    ref,
  } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    DIALOGS_KEY,
    DialogsPlugin,
    VueBusPlugin,
    VUEBUS_KEY,
    NOTIFICATIONS_KEY,
    NotificationsPlugin,
  } from '@v1nt1248/3nclient-lib/plugins';
  import type { Nullable, Ui3nTableExpose } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useFsStore, useRunModeInfoStore } from '@/store';
  import { useNavigation } from '@/composables/useNavigation';
  import type { AppGlobalEvents, FsEntityInfoProvideProps, ListingEntryExtended } from '@shared/types';
  import { USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER } from '@shared/constants';
  import type { FsTableBulkActionName } from '@/components/common/fs-table-bulk-actions/types';
  import FsTable from '@/components/common/fs-table/fs-table.vue';
  import TableBulkActions from '@/components/common/fs-table-bulk-actions/fs-table-bulk-actions.vue';
  import size from 'lodash/size';

  const props = defineProps<{
    windowIndex: 1 | 2;
  }>();

  const { t } = useI18n();

  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { openFsEntityInfoBlock } = inject<FsEntityInfoProvideProps>('fsEntityInfo')!;

  const {
    route,
    isSplittedMode,
    activeWindow,
    window1FsId,
    window1RootFolderId,
    window2FsId,
    window2RootFolderId,
    navigateToRouteSingle,
    navigateToRouteDouble,
    selectActiveWindow,
  } = useNavigation();

  const appStore = useAppStore();
  const { commonLoading, trashFolderName } = storeToRefs(appStore);
  const { setCommonLoading } = appStore;

  const { downloadEntities, restoreEntities } = useFsStore();

  const runModeInfoStore = useRunModeInfoStore();
  const { isDragging, isMoveMode, isMoveModeQuick } = storeToRefs(runModeInfoStore);
  const { toggleCopyMoveMode, deleteSelectedEntities } = runModeInfoStore;

  const tableComponent = ref<Nullable<Ui3nTableExpose<ListingEntryExtended>>>(null);

  const tableFsId = computed(() => {
    if (isSplittedMode.value) {
      return props.windowIndex === 1 ? window1FsId.value : window2FsId.value;
    }

    return window1FsId.value;
  }) as ComputedRef<string>;

  const tableRootFolderId = computed(() => {
    if (isSplittedMode.value) {
      return props.windowIndex === 1 ? window1RootFolderId.value : window2RootFolderId.value!;
    }

    return window1RootFolderId.value;
  });

  const currentProcessedPath = computed(() => {
    if (isSplittedMode.value) {
      return props.windowIndex === 1 ? route.query.path || '' : route.query.path2 || '';
    }

    return route.query.path || '';
  }) as ComputedRef<string>;

  function closeFsInfoBlock() {
    openFsEntityInfoBlock(null);
  }

  async function go(fullPath: string) {
    closeFsInfoBlock();
    if (isSplittedMode.value) {
      return navigateToRouteDouble({
        query: {
          ...(props.windowIndex === 1 && { path: fullPath }),
          ...(props.windowIndex === 2 && { path2: fullPath }),
        },
      });
    }

    return navigateToRouteSingle({
      params: { rootFolderId: tableRootFolderId.value },
      query: { path: fullPath },
    });
  }

  async function handleBulkActions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { action, payload }: { action: FsTableBulkActionName; payload?: unknown },
    entities: ListingEntryExtended[],
  ) {
    openFsEntityInfoBlock(null);

    switch (action) {
      case 'set:favorite':
        break;
      case 'copy/move':
        break;
      case 'delete': {
        await deleteSelectedEntities({ fsId: tableFsId.value, entities, completely: false });
        break;
      }

      case 'delete:completely': {
        const component = defineAsyncComponent(() => import('@/components/dialogs/confirmation-dialog.vue'));
        const res = await dialogs.$openDialog(component, {
          dialogText: t('fs.permanently_delete.warning1'),
          additionalDialogText: t('fs.permanently_delete.warning2'),
          dialogProps: {
            title: t('fs.permanently_delete.title'),
            confirmButtonText: t('fs.permanently_delete.button.confirm'),
            confirmButtonBackground: 'var(--error-content-default)',
            confirmButtonColor: 'var(--error-fill-default)',
          },
        });

        const { event } = res;
        if (event === 'confirm') {
          try {
            await deleteSelectedEntities({ fsId: tableFsId.value, entities, completely: true });

            notifications.$createNotice({
              type: 'info',
              withIcon: true,
              content: t('fs.entity.message.success.delete', { count: `${entities.length}` }),
            });
          } catch (err) {
            w3n.log('error', err as string);

            notifications.$createNotice({
              type: 'error',
              withIcon: true,
              content: t('fs.entity.message.error.delete', { count: `${entities.length}` }),
            });
          }
        }

        break;
      }

      case 'restore': {
        let restoredParentFoldersLists: string[] | undefined;
        try {
          restoredParentFoldersLists = await restoreEntities({ fsId: tableFsId.value, entities });
          if (size(restoredParentFoldersLists) > 0) {
            console.log('💥 SYNC AFTER RESTORE ENTITIES 💥');
            bus.$emitter.emit('refresh:data', { path: trashFolderName.value });
            for (const restoredParentFolder of restoredParentFoldersLists!) {
              bus.$emitter.emit('refresh:data', { path: restoredParentFolder });
            }

            notifications.$createNotice({
              type: 'success',
              withIcon: true,
              content: t('fs.entity.message.success.restore'),
            });
          }
        } catch (err) {
          w3n.log('error', err as string);
          notifications.$createNotice({
            type: 'error',
            withIcon: true,
            content: t('fs.entity.message.error.restore'),
          });
        }
        break;
      }

      case 'download':
        await downloadEntities({ fsId: tableFsId.value, entities });
        break;

      case 'resolve': {
        const component = defineAsyncComponent(
          () => import('@/components/dialogs/resolve-conflicts-dialog/resolve-conflicts-dialog.vue'),
        );

        await dialogs.$openDialog<boolean>(component, {
          paths: entities.map(e => e.fullPath),
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
        bus.$emitter.emit('refresh:data', { path: currentProcessedPath.value });
        break;
      }
    }
  }

  onBeforeMount(() => {
    bus.$emitter.on('click:breadcrumb', closeFsInfoBlock);
  });

  onBeforeUnmount(() => {
    bus.$emitter.off('click:breadcrumb', closeFsInfoBlock);
  });
</script>

<template>
  <div
    v-if="tableFsId"
    :class="$style.tableView"
  >
    <div :class="$style.content">
      <fs-table
        :fs-id="tableFsId"
        :root-folder-id="tableRootFolderId"
        :window-index="windowIndex"
        :base-path="{
          fullPath: [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(tableRootFolderId)
            ? trashFolderName
            : '',
          title: '',
        }"
        :path="currentProcessedPath"
        :is-in-split-mode="isSplittedMode"
        :is-in-dragging-mode="isDragging"
        :is-active="activeWindow === `${windowIndex}`"
        :is-loading="commonLoading"
        @init="tableComponent = $event"
        @loading="setCommonLoading($event)"
        @make:active="selectActiveWindow(windowIndex)"
        @go="go"
        @open:info="
          path =>
            path === null
              ? openFsEntityInfoBlock(null)
              : openFsEntityInfoBlock({ fsId: tableFsId, path, windowIndex: `${windowIndex}` })
        "
      >
        <template #group-actions="{ selectedRows }">
          <table-bulk-actions
            :fs-id="tableFsId"
            :root-folder-id="tableRootFolderId"
            :folder-path="currentProcessedPath"
            :window-index="windowIndex"
            :is-in-split-mode="isSplittedMode"
            :selected-entities="selectedRows"
            :is-move-mode="isMoveMode"
            :is-move-mode-quick="isMoveModeQuick"
            :disabled="commonLoading"
            @action="handleBulkActions($event, selectedRows)"
            @update:move-mode="toggleCopyMoveMode"
          />
        </template>
      </fs-table>
    </div>
  </div>
</template>

<style lang="scss" module>
  .tableView {
    --header-height: 64px;

    display: flex;
    position: relative;
    width: 100%;
    height: 100%;
    cursor: default;
    overflow-y: auto;
  }

  .content {
    position: relative;
    width: 100%;
    height: 100%;
  }
</style>
