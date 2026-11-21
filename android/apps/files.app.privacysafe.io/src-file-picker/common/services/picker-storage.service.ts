import { makeServiceCaller } from '@shared/utils/ipc/ipc-service-caller';
import { PICKER_SERVICE_METHODS, type PickerServiceMethod, type StorageAppDenoService } from '@deno/types';

export let pickerStorageSrv: Pick<StorageAppDenoService, PickerServiceMethod>;

/**
 * Connects to 'AppStoragePicker': the service with only the read-only methods
 * the picker needs. Pickers run as dialogs of other apps and have no access to
 * the main AppStorageInternal service.
 */
export async function initializePickerStorageService(): Promise<void> {
  const srvConnection = await w3n.rpc!.thisApp!('AppStoragePicker');
  pickerStorageSrv = makeServiceCaller<Pick<StorageAppDenoService, PickerServiceMethod>>(srvConnection, [
    ...PICKER_SERVICE_METHODS,
  ]) as Pick<StorageAppDenoService, PickerServiceMethod>;
}
