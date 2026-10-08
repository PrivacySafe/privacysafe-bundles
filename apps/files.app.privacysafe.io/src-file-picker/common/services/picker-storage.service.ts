import { makeServiceCaller } from '@shared/utils/ipc/ipc-service-caller';
import type { StorageAppDenoService } from '@deno/types';

export let pickerStorageSrv: StorageAppDenoService;

/**
 * Connect only the AppStorageInternal methods required by the picker.
 * This avoids bootstrapping the main Storage application's full RPC surface.
 */
export async function initializePickerStorageService(): Promise<void> {
  const srvConnection = await w3n.rpc!.thisApp!('AppStorageInternal');
  pickerStorageSrv = makeServiceCaller<StorageAppDenoService>(srvConnection, [
    'getFsList',
    'getFsRootFolderList',
    'getFolderContentFilledList',
  ]) as StorageAppDenoService;
}
