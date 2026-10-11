import { nextTick, watch, onBeforeUnmount } from 'vue';
import type { PickerStateApi } from '@picker/common/composables/usePickerState';

interface HistoryEntry {
  rootId: string;
  path: string;
}

interface ExitHistoryEntry {
  exitPicker: true;
}

type PickerHistoryEntry = HistoryEntry | ExitHistoryEntry;

function isExitHistoryEntry(entry: PickerHistoryEntry | null): entry is ExitHistoryEntry {
  return !!entry && 'exitPicker' in entry && entry.exitPicker === true;
}

export function usePickerHistory(picker: PickerStateApi, onExit: () => void) {
  let restoring = false;
  let initialized = false;

  // Keep one picker-owned entry behind the initial location. When Android's
  // system Back reaches it, cancel the dialog instead of falling through to
  // the WebView/Activity back behavior with an unresolved capability request.
  history.replaceState({ exitPicker: true } satisfies ExitHistoryEntry, '');

  const stopWatch = watch(
    () => [picker.activeRootId.value, picker.currentWindow.value.currentPath] as const,
    ([rootId, path]) => {
      if (restoring || !rootId) {
        return;
      }

      const entry = { rootId, path } satisfies HistoryEntry;
      if (!initialized) {
        history.pushState(entry, '');
        initialized = true;
        return;
      }

      const current = history.state as PickerHistoryEntry | null;

      if (!isExitHistoryEntry(current) && current?.rootId === rootId && current.path === path) {
        return;
      }

      history.pushState(entry, '');
    },
    { immediate: true },
  );

  async function onPopState(e: PopStateEvent) {
    if (picker.isBusy.value) {
      history.pushState(
        {
          rootId: picker.activeRootId.value,
          path: picker.currentWindow.value.currentPath,
        } satisfies HistoryEntry,
        '',
      );
      return;
    }
    const entry = e.state as PickerHistoryEntry | null;
    if (isExitHistoryEntry(entry)) {
      onExit();
      return;
    }

    if (!entry) {
      return;
    }

    restoring = true;
    try {
      await picker.restoreLocation(entry.rootId, entry.path);
      // Keep the guard active through Vue's watcher flush caused by the
      // restored currentPath/activeRootId commit.
      await nextTick();
    } finally {
      restoring = false;
    }
  }

  window.addEventListener('popstate', onPopState);

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState);
    stopWatch();
  });
}
