import { type ComputedRef, ref, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import size from 'lodash/size';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { ListingEntryExtended } from '@shared/types';
import { useFsWindowState } from '@/composables/useFsWindowState';
import { useAbilities } from '@/composables/useAbilities';
import { useAppStore, useRunModeInfoStore } from '@/store';

export function useFsDnD(fsWindowNumber: ComputedRef<'1' | '2'>, selectedEntities: Ref<ListingEntryExtended[]>) {
  const { operatingSystem } = storeToRefs(useAppStore());

  const runModeInfoStore = useRunModeInfoStore();
  const { isMoveModeQuick } = storeToRefs(runModeInfoStore);
  const { onDragStart, onDragEnd, resetDragState, isDropTargetInsideDragged } = runModeInfoStore;

  const draggedEntities = ref<string[]>([]);
  const droppableEntity = ref<Nullable<string>>(null);
  const ghostEl = ref<Nullable<HTMLDivElement>>(null);

  const { currentWindowFsId, currentWindowRootFolderId } = useFsWindowState(fsWindowNumber);
  const { canDrop } = useAbilities();

  function parseDraggedData(
    text: string | undefined,
  ): Nullable<{ fsId: string; value: ListingEntryExtended[] }> {
    if (!text) {
      return null;
    }
    try {
      const data = JSON.parse(text);
      return typeof data?.fsId === 'string' && Array.isArray(data?.value) ? data : null;
    } catch {
      return null;
    }
  }

  function getGhostElementText(data: ListingEntryExtended[]): string {
    if (size(data) === 0) return '';

    const name = data[0].name;
    const processedName = size(name) > 40 ? `${name.slice(0, 40)}...` : name;

    return size(data) > 1 ? `${processedName} (+${size(data) - 1})` : processedName;
  }

  async function onDragstart(ev: DragEvent, entity: ListingEntryExtended) {
    if (ev.dataTransfer) {
      // an entity of the selection takes the whole selection along; an entity that is
      // not selected is dragged alone (a quick drag, see isMoveMode in the store)
      const isFromSelection = selectedEntities.value.some(e => e.fullPath === entity.fullPath);
      const entities = isFromSelection ? selectedEntities.value : [entity];
      const data = JSON.stringify({ fsId: currentWindowFsId.value, value: entities });

      draggedEntities.value = entities.map(e => e.fullPath);

      const ghostElText = getGhostElementText(entities);

      ghostEl.value = document.getElementById('app-dragging-ghost')!.cloneNode(true) as HTMLDivElement;
      const ghostElContent = ghostEl.value.querySelector('span');
      ghostElContent!.innerText = ghostElText;
      document.body.appendChild(ghostEl.value);

      ev.dataTransfer.setData('text/plain', data);
      ev.dataTransfer.effectAllowed = 'copyMove';
      ev.dataTransfer.setDragImage(ghostEl.value!, -8, 0);

      await onDragStart(fsWindowNumber.value, isFromSelection ? 'selection' : 'quick', {
        fsId: currentWindowFsId.value as string,
        folderPaths: entities.filter(e => e.type === 'folder').map(e => e.fullPath),
      });
    }
  }

  function onDragend() {
    droppableEntity.value = null;
    draggedEntities.value = [];
    ghostEl.value?.remove();
    ghostEl.value = null;
    // the toggle (isMoveMode) is kept: it is the user's choice, not a part of this drag
    resetDragState();
  }

  function isDroppable(ev: DragEvent, entity: ListingEntryExtended) {
    const { altKey, ctrlKey } = ev;

    isMoveModeQuick.value =
      (operatingSystem.value === 'macos' && altKey) || (operatingSystem.value !== 'macos' && ctrlKey);

    // without preventDefault() the browser shows the "not allowed" cursor and does not drop
    if (entity.type === 'folder' && isDropTargetInsideDragged(currentWindowFsId.value, entity.fullPath)) {
      droppableEntity.value = null;
      return;
    }

    if (entity.type === 'folder') {
      droppableEntity.value = entity.fullPath;
      ev.preventDefault();
    } else {
      droppableEntity.value = null;
    }
  }

  function onDragleave(ev: DragEvent, entity: ListingEntryExtended): void {
    if (droppableEntity.value && droppableEntity.value === entity.fullPath) {
      droppableEntity.value = null;
    }
    ev.preventDefault();
  }

  async function onDrop(ev: DragEvent, entity: ListingEntryExtended) {
    ev.preventDefault();

    try {
      const isDropAvailable = canDrop(currentWindowFsId.value, currentWindowRootFolderId.value);
      // text dropped from another app is not ours: it is ignored
      const source = isDropAvailable ? parseDraggedData(ev.dataTransfer?.getData('text/plain')) : null;

      if (source) {
        const target = !draggedEntities.value.includes(entity.fullPath) ? entity : null;

        await onDragEnd({
          sourceFsId: source.fsId,
          data: source.value,
          targetFsId: currentWindowFsId.value as string,
          target,
        });
      }
    } finally {
      // always leave the dragging mode, otherwise the drop area of OS files stays hidden
      onDragend();
    }
  }

  return {
    draggedEntities,
    droppableEntity,
    ghostEl,
    onDragstart,
    onDragend,
    isDroppable,
    onDragleave,
    onDrop,
  };
}
