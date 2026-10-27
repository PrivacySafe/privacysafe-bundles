import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { dialogs, vueBus, notifications, storeNotifications, theme } from '@v1nt1248/3nclient-lib/plugins';
import i18n from '@/data/i18';

import {
  createDialogRequestState,
  DIALOG_REQUEST_KEY,
  failDialog,
  registerDialogCapabilities,
  settleDialog,
} from '@picker/common/dialog-capabilities';
import { initializePickerStorageService } from '@picker/common/services/picker-storage.service';
import { usePickerFsStore } from '@picker/common/stores/picker-fs.store';

interface PickerBootstrapOptions {
  rootComponent: Component;
  mountSelector: string;
}

// the storage service may still be starting (e.g. right after the platform starts)
const STARTUP_TIMEOUT = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function bootstrapPicker({ rootComponent, mountSelector }: PickerBootstrapOptions): void {
  const dialogRequest = createDialogRequestState();
  registerDialogCapabilities(dialogRequest);

  // The window closed by the OS: the user did not choose anything. Best effort,
  // the answer may not get out before the window is gone.
  window.addEventListener('pagehide', () => settleDialog(dialogRequest, undefined, { closeWindow: false }));

  void withTimeout(
    initializePickerStorageService(),
    STARTUP_TIMEOUT,
    'The storage service did not respond in time.',
  )
    .then(async () => {
      const pinia = createPinia();
      const app = createApp(rootComponent);
      pinia.use(storeNotifications);

      app.provide(DIALOG_REQUEST_KEY, dialogRequest);
      app.use(theme, { theme: 'dark' }).use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications);

      // Install Pinia on the app before creating the picker store so Pinia
      // plugins receive the same app context they do during normal component
      // setup. Components are still not mounted until filesystem init succeeds.
      const fsStore = usePickerFsStore(pinia);
      await withTimeout(fsStore.initializeFsItems(), STARTUP_TIMEOUT, 'The storage service did not respond in time.');

      app.mount(mountSelector);
    })
    .catch(err => {
      console.error('🔥 ERROR CREATE FILE PICKER. ', err);
      // a failure, not a cancellation: the caller gets an error, not undefined
      failDialog(dialogRequest, err);
    });
}
