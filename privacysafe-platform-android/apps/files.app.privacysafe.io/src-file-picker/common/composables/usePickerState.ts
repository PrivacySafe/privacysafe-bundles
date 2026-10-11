import { reactive, computed, provide, inject, ref, watch, type InjectionKey } from 'vue';
import { storeToRefs } from 'pinia';
import { pickerStorageSrv } from '@picker/common/services/picker-storage.service';
import { usePickerFsStore } from '@picker/common/stores/picker-fs.store';
import { groupPickerFsRoots } from '@picker/common/utils/picker-fs-grouping';
import { getPickerOperatingSystem } from '@picker/common/utils/operating-system';
import type { ListingEntryExtended, RootFsFolderView } from '@shared/types';
import type { PickerState, PickerWindowState, PickerFile, PickerRootId } from '@picker/common/types';
import type { DialogRequestState } from '@picker/common/types/dialog-types';
import { isValidFileName } from '@picker/common/utils/validate-filename';
import { openFolderTarget, type PickerFolderTarget } from '@picker/common/utils/folder-operations';

function createDefaultWindowState(): PickerWindowState {
  return {
    currentPath: '',
    sortBy: 'name',
    sortOrder: 'asc',
    entries: [],
    status: 'idle',
  };
}

interface DefaultSaveLocation {
  folderPath: string;
  fileName: string;
}

function parseDefaultSaveLocation(defaultPath?: string): DefaultSaveLocation {
  const normalizedPath = (defaultPath ?? '').trim().replaceAll('\\', '/');
  if (!normalizedPath) {
    return {
      folderPath: '',
      fileName: '',
    };
  }

  // A trailing separator means the caller supplied a folder location rather
  // than a filename as the final path segment.
  const pointsToFolder = normalizedPath.endsWith('/');
  const path = normalizedPath.replace(/^\/+|\/+$/g, '');
  if (!path) {
    return {
      folderPath: '',
      fileName: '',
    };
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) {
    return { folderPath: '', fileName: '' };
  }
  if (pointsToFolder) {
    return {
      folderPath: segments.join('/'),
      fileName: '',
    };
  }

  const fileName = segments.pop() ?? '';

  return {
    folderPath: segments.join('/'),
    fileName,
  };
}

function createPickerState(dialogRequest: DialogRequestState) {
  const fsStore = usePickerFsStore();
  const { fsAvailableFolderList, fsList } = storeToRefs(fsStore);

  const categories = computed(() => groupPickerFsRoots(fsAvailableFolderList.value));
  const flatRoots = computed<RootFsFolderView[]>(() => categories.value.flatMap(category => category.roots));
  const homeRootId = computed(() => categories.value.find(category => category.key === 'home')?.roots[0]?.id);
  const operatingSystem = getPickerOperatingSystem();

  const state = reactive<PickerState>({
    activeRootId: '',
    windows: {},
  });

  const isBusy = ref(false);
  const isSaveMode = computed(() => dialogRequest.mode === 'saveFile' || dialogRequest.mode === 'saveFolder');
  const isFolderMode = computed(() => dialogRequest.mode === 'openFolder' || dialogRequest.mode === 'saveFolder');

  const defaultSaveLocation = computed(() => parseDefaultSaveLocation(dialogRequest.defaultPath));

  // null means the user has not edited the field yet. Until then the filename
  // is derived from dialogRequest.defaultPath, including a full path delivered
  // after the picker state was created.
  const saveNameOverride = ref<string | null>(null);
  const saveName = computed({
    get: () => saveNameOverride.value ?? defaultSaveLocation.value.fileName,
    set: (name: string) => {
      saveNameOverride.value = name;
    },
  });

  // Each root gets its own monotonically increasing load generation. Only the
  // newest generation is allowed to commit status/data/errors for that root.
  const loadGenerations = new Map<PickerRootId, number>();

  function nextLoadGeneration(rootId: PickerRootId): number {
    const generation = (loadGenerations.get(rootId) ?? 0) + 1;
    loadGenerations.set(rootId, generation);
    return generation;
  }

  function isLatestLoad(rootId: PickerRootId, generation: number): boolean {
    return loadGenerations.get(rootId) === generation;
  }

  function ensureWindow(rootId: PickerRootId): PickerWindowState {
    if (!state.windows[rootId]) {
      state.windows[rootId] = createDefaultWindowState();
    }
    return state.windows[rootId];
  }

  const currentWindow = computed(() => ensureWindow(state.activeRootId));

  function findRoot(rootId: PickerRootId): RootFsFolderView | undefined {
    return flatRoots.value.find(root => root.id === rootId);
  }

  const activeFsId = computed(() => findRoot(state.activeRootId)?.fsId ?? '');

  async function getFs(rootId: PickerRootId): Promise<web3n.files.FS> {
    const root = findRoot(rootId);
    const item = root ? fsList.value[root.fsId] : undefined;
    if (!item?.entity) {
      throw new Error(`No FS entity resolved for root '${rootId}' (fsId '${root?.fsId ?? '?'}').`);
    }
    return item.entity;
  }

  async function getWritableFs(rootId: PickerRootId): Promise<web3n.files.WritableFS> {
    const fs = await getFs(rootId);
    if (!fs.writable || !('writableSubRoot' in fs)) {
      throw new Error('The selected filesystem is read-only.');
    }
    return fs;
  }

  function mapListingEntry(entry: ListingEntryExtended, path: string): PickerFile {
    return {
      // Keep picker navigation paths source-relative even though the service
      // also returns fullPath/basePath-aware values.
      id: path ? `${path}/${entry.name}` : entry.name,
      name: entry.name,
      isFolder: entry.type === 'folder',
      size: entry.size,
      ctime: entry.ctime ?? entry.mtime,
    };
  }

  async function loadEntries(rootId: PickerRootId, path: string): Promise<void> {
    const root = findRoot(rootId);
    if (!root) {
      return;
    }

    const win = ensureWindow(rootId);
    const generation = nextLoadGeneration(rootId);
    win.status = 'loading';
    win.error = undefined;

    try {
      const data = await pickerStorageSrv.getFolderContentFilledList({
        fsId: root.fsId,
        path,
        operatingSystem,
      });
      if (!isLatestLoad(rootId, generation)) {
        return;
      }
      win.entries = data.map(entry => mapListingEntry(entry, path));
      win.currentPath = path;
      win.status = 'ready';
    } catch (err) {
      if (!isLatestLoad(rootId, generation)) {
        return;
      }
      win.status = 'error';
      win.error = err;
    }
  }

  async function switchRoot(rootId: PickerRootId): Promise<void> {
    if (isBusy.value || !rootId) {
      return;
    }

    const win = ensureWindow(rootId);

    if (rootId === state.activeRootId) {
      if (win.currentPath || win.status === 'error') {
        await loadEntries(rootId, '');
      }
      return;
    }

    // An errored root may still carry the last successfully displayed path.
    // Reset that inactive window before exposing it as active so history does
    // not record a stale nested path immediately before the retry-at-root.
    if (win.status === 'error') {
      win.currentPath = '';
    }
    state.activeRootId = rootId;
    if (win.status === 'idle' || win.status === 'error') {
      await loadEntries(rootId, '');
    }
  }

  async function navigateToFolder(path: string): Promise<void> {
    if (isBusy.value) {
      return;
    }
    return loadEntries(state.activeRootId, path);
  }

  async function restoreLocation(rootId: PickerRootId, path: string): Promise<void> {
    if (isBusy.value || !rootId) {
      return;
    }
    state.activeRootId = rootId;
    await loadEntries(rootId, path);
  }

  function setSort(sortBy: string, sortOrder: 'asc' | 'desc') {
    currentWindow.value.sortBy = sortBy;
    currentWindow.value.sortOrder = sortOrder;
  }

  function isSaveNameValid(name: string): boolean {
    return isValidFileName(name);
  }

  function findNameCollision(name: string): PickerFile | undefined {
    if (!name) {
      return undefined;
    }
    return currentWindow.value.entries.find(entry => entry.name === name);
  }

  async function initializeDefaultRoot(rootId: PickerRootId): Promise<void> {
    const initialPath = isSaveMode.value ? defaultSaveLocation.value.folderPath : '';
    state.activeRootId = rootId;
    await loadEntries(rootId, initialPath);

    if (initialPath && ensureWindow(rootId).status === 'error') {
      // A caller-provided parent path may be stale or unavailable. Keep the
      // filename, but fall back to the Home root instead of stranding the
      // picker on its initial error screen.
      await loadEntries(rootId, '');
    }
  }

  watch(
    [homeRootId, () => dialogRequest.mode, () => dialogRequest.defaultPath],
    ([rootId, mode]) => {
      if (!rootId || !mode || state.activeRootId) {
        return;
      }

      void initializeDefaultRoot(rootId);
    },
    { immediate: true },
  );

  async function resolveSelectedFiles(paths: string[]): Promise<web3n.files.ReadonlyFile[]> {
    const fs = await getFs(state.activeRootId);
    return Promise.all(paths.map(path => fs.readonlyFile(path)));
  }

  async function resolveSaveFile(): Promise<web3n.files.WritableFile> {
    const fs = await getWritableFs(state.activeRootId);
    const path = currentWindow.value.currentPath
      ? `${currentWindow.value.currentPath}/${saveName.value}`
      : saveName.value;
    return fs.writableFile(path);
  }

  const canWrite = computed(() => {
    const root = findRoot(state.activeRootId);
    return !!root && fsList.value[root.fsId]?.entity.writable === true;
  });

  async function getFolderTarget(name = ''): Promise<PickerFolderTarget> {
    const rootId = state.activeRootId;
    const parentPath = currentWindow.value.currentPath;
    const trimmed = name.trim();
    if (trimmed && !isValidFileName(trimmed)) {
      throw new Error('Invalid folder name.');
    }
    const fs = await getWritableFs(rootId);
    return {
      fs,
      path: trimmed ? (parentPath ? `${parentPath}/${trimmed}` : trimmed) : parentPath || '/',
      name: trimmed || parentPath.split('/').pop() || fs.name || findRoot(rootId)?.name || '/',
    };
  }

  async function createFolder(name: string): Promise<void> {
    if (!isValidFileName(name)) {
      throw new Error('Invalid folder name.');
    }
    const rootId = state.activeRootId;
    const target = await getFolderTarget(name);
    await target.fs.makeFolder(target.path, true);
    // This is an explicit user creation. Keep the folder if the picker is
    // subsequently cancelled; enter it without settling the calling app.
    await loadEntries(rootId, target.path);
  }

  async function resolveSelectedFolders(paths: string[]): Promise<web3n.files.WritableFS[]> {
    const fs = await getWritableFs(state.activeRootId);
    const folders: web3n.files.WritableFS[] = [];
    try {
      for (const path of paths) {
        folders.push(await openFolderTarget({ fs, path: path || '/', name: '' }));
      }
      return folders;
    } catch (error) {
      // If one selection fails, release only the sub-roots we opened here.
      await Promise.allSettled(folders.map(folder => folder.close()));
      throw error;
    }
  }

  return {
    activeRootId: computed(() => state.activeRootId),
    activeFsId,
    categories,
    isBusy,
    isSaveMode,
    isFolderMode,
    canWrite,
    saveName,
    currentWindow,
    switchRoot,
    navigateToFolder,
    restoreLocation,
    setSort,
    findNameCollision,
    isSaveNameValid,
    resolveSelectedFiles,
    resolveSaveFile,
    getFolderTarget,
    createFolder,
    resolveSelectedFolders,
  };
}

export type PickerStateApi = ReturnType<typeof createPickerState>;

export const PICKER_STATE_KEY: InjectionKey<PickerStateApi> = Symbol('picker-state');

export function providePickerState(dialogRequest: DialogRequestState) {
  const api = createPickerState(dialogRequest);
  provide(PICKER_STATE_KEY, api);
  return api;
}

export function usePickerState(): PickerStateApi {
  const api = inject(PICKER_STATE_KEY);
  if (!api) {
    throw new Error(
      'usePickerState() called outside <FilePicker> — did you forget to mount it under the root component?',
    );
  }
  return api;
}
