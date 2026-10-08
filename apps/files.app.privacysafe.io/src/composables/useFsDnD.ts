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
  const { isDragging, isMoveMode, isMoveModeQuick } = storeToRefs(runModeInfoStore);
  const { onDragStart, onDragEnd } = runModeInfoStore;

  const draggedEntities = ref<string[]>([]);
  const droppableEntity = ref<Nullable<string>>(null);
  const ghostEl = ref<Nullable<HTMLDivElement>>(null);

  const { currentWindowFsId, currentWindowRootFolderId } = useFsWindowState(fsWindowNumber);
  const { canDrop } = useAbilities();

  function getGhostElementText(data: ListingEntryExtended[]): string {
    if (size(data) === 0) return '';

    const name = data[0].name;
    const processedName = size(name) > 40 ? `${name.slice(0, 40)}...` : name;

    return size(data) > 1 ? `${processedName} (+${size(data) - 1})` : processedName;
  }

  async function onDragstart(ev: DragEvent, entity: ListingEntryExtended) {
    // console.log('# USE_DND | DRAG START # => ', ev, entity);
    if (ev.dataTransfer) {
      const data =
        size(selectedEntities.value) > 1
          ? JSON.stringify({ fsId: currentWindowFsId.value, value: selectedEntities.value })
          : JSON.stringify({ fsId: currentWindowFsId.value, value: [entity] });

      draggedEntities.value =
        size(selectedEntities.value) > 1 ? selectedEntities.value.map(e => e.fullPath) : [entity.fullPath];

      const ghostElText = getGhostElementText(selectedEntities.value);

      ghostEl.value = document.getElementById('app-dragging-ghost')!.cloneNode(true) as HTMLDivElement;
      const ghostElContent = ghostEl.value.querySelector('span');
      ghostElContent!.innerText = ghostElText;
      document.body.appendChild(ghostEl.value);

      ev.dataTransfer.setData('text/plain', data);
      ev.dataTransfer.effectAllowed = 'copyMove';
      ev.dataTransfer.setDragImage(ghostEl.value!, -8, 0);

      await onDragStart(fsWindowNumber.value);
    }
  }

  function onDragend() {
    // console.log('# USE_DND | DRAG END #');
    droppableEntity.value = null;
    draggedEntities.value = [];
    ghostEl.value && document.body.removeChild(ghostEl.value);
    ghostEl.value = null;
    isDragging.value = false;
    isMoveMode.value = false;
  }

  function isDroppable(ev: DragEvent, entity: ListingEntryExtended) {
    // console.log('# USE_DND | IS_DROPPABLE # => ', ev, entity);
    const { altKey, ctrlKey } = ev;

    isMoveModeQuick.value =
      (operatingSystem.value === 'macos' && altKey) || (operatingSystem.value !== 'macos' && ctrlKey);

    if (entity.type === 'folder') {
      droppableEntity.value = entity.fullPath;
      ev.preventDefault();
    } else {
      droppableEntity.value = null;
    }
  }

  function onDragleave(ev: DragEvent, entity: ListingEntryExtended): void {
    // console.log('# USE_DND | DRAG LEAVE # => ', ev, entity);
    if (droppableEntity.value && droppableEntity.value === entity.fullPath) {
      droppableEntity.value = null;
    }
    ev.preventDefault();
  }

  async function onDrop(ev: DragEvent, entity: ListingEntryExtended) {
    // console.log('# USE_DND | DROP # => ', ev, entity);
    const isDropAvailable = canDrop(currentWindowFsId.value, currentWindowRootFolderId.value);

    if (isDropAvailable) {
      const sourceAsString = ev.dataTransfer?.getData('text/plain');
      const source: Nullable<{
        fsId: string;
        value: ListingEntryExtended[];
      }> = sourceAsString ? JSON.parse(sourceAsString) : null;

      const target = !draggedEntities.value.includes(entity.fullPath) ? entity : null;

      await onDragEnd({
        sourceFsId: source?.fsId || null,
        data: source?.value || null,
        targetFsId: currentWindowFsId.value as string,
        target,
      });
    }

    onDragend();
    ev.preventDefault();
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
