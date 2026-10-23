import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { dialogs, vueBus, notifications, storeNotifications, theme } from '@v1nt1248/3nclient-lib/plugins';
import i18n from '@/data/i18';

import {
  createDialogRequestState,
  DIALOG_REQUEST_KEY,
  registerDialogCapabilities,
  settleDialog,
} from '@picker/common/dialog-capabilities';
import { initializePickerStorageService } from '@picker/common/services/picker-storage.service';
import { usePickerFsStore } from '@picker/common/stores/picker-fs.store';

interface PickerBootstrapOptions {
  rootComponent: Component;
  mountSelector: string;
}

export function bootstrapPicker({ rootComponent, mountSelector }: PickerBootstrapOptions): void {
  const dialogRequest = createDialogRequestState();
  registerDialogCapabilities(dialogRequest);

  void initializePickerStorageService()
    .then(async () => {
      const pinia = createPinia();
      const app = createApp(rootComponent);
      pinia.use(storeNotifications);

      app.config.compilerOptions.isCustomElement = tag => tag.startsWith('ui3n-');

      app.provide(DIALOG_REQUEST_KEY, dialogRequest);
      app.use(theme, { theme: 'dark' }).use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications);

      // Install Pinia on the app before creating the picker store so Pinia
      // plugins receive the same app context they do during normal component
      // setup. Components are still not mounted until filesystem init succeeds.
      const fsStore = usePickerFsStore(pinia);
      await fsStore.initializeFsItems();

      app.mount(mountSelector);
    })
    .catch(err => {
      console.error('🔥 ERROR CREATE FILE PICKER. ', err);
      settleDialog(dialogRequest, undefined);
    });
}
