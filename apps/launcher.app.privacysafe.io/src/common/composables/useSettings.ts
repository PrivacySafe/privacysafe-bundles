/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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
*/
import { inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
  type ThemeId,
} from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@/common/store/app.store';
import { useAppsStore } from '@/common/store/apps.store';
import { SettingsJSON } from '@/common/store/app/ui-settings';
import { readImageFileIntoDataURL, selectOneImageFileWithDialog } from '../utils/image-files';
import TurnAutologinOn from '../dialogs/turn-autologin-on.vue';

export function useSettings() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const appStore = useAppStore();
  const { updateSettings } = appStore;
  const { colorTheme, lang, allowShowingDevtool, customLogoSrc } = storeToRefs(appStore);

  const appsStore = useAppsStore();
  const { toggleAutoUpdate } = appsStore;
  const { autoUpdate } = storeToRefs(appsStore);

  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  async function updateAppConfig(appConfig: Partial<SettingsJSON>) {
    try {
      await updateSettings(appConfig);
      $createNotice({
        type: 'success',
        content: t('settings.messages.save_success'),
      });
    } catch (e) {
      console.error('Settings saving error: ', e);
      $createNotice({
        type: 'error',
        content: t('settings.messages.save_error'),
      });
    }
  }

  function changeColorTheme(val: ThemeId) {
    if (colorTheme.value === val) {
      return;
    }

    updateAppConfig({
      colorTheme: val,
    });
  }

  function changeAllowShowingDevtool(val: boolean) {
    updateSettings({
      allowShowingDevtool: val,
    });
  }

  function wipeDataFromDevice() {
    w3n.system.platform?.wipeFromThisDevice();
  }

  async function addCustomLogo() {
    const imgFile = await selectOneImageFileWithDialog(
      t('dialog.select-logo-file.title'),
      t('dialog.select-logo-file.btn'),
      t,
    );
    if (imgFile) {
      updateSettings({
        customLogo: await readImageFileIntoDataURL(imgFile),
      });
    }
  }

  function removeCustomLogo() {
    updateSettings({
      customLogo: undefined,
    });
  }

  const autoLogin = ref(false);
  const autoLoginSetupOpened = ref(false);

  async function updateAutoLoginRef() {
    autoLogin.value = await w3n.system.userLogin!.isAutoLoginSet();
    autoLoginSetupOpened.value = false;
    console.log(`autoLogin.value -> ${autoLogin.value}`);
  }

  async function changeAutoLogin(enable: boolean) {
    console.log(`changeAutoLogin -> ${enable}`);
    if (enable) {
      autoLoginSetupOpened.value = true;

      const res = await dialog.$openDialog<string>(TurnAutologinOn, {
        dialogProps: {
          title: t('dialog.settings_dialog_autologin.title'),
        },
      });

      const { event, data } = res;

      if (event === 'confirm') {
        try {
          if (data) {
            await w3n.system.userLogin!.setAutoLogin(data, () => {
              /* empty */
            });
            $createNotice({
              type: 'success',
              content: t('settings.messages.autologin_set_success'),
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          $createNotice({
            type: 'error',
            content: t('settings.autologin_password_wrong'),
          });
        } finally {
          updateAutoLoginRef();
        }
      } else {
        updateAutoLoginRef();
      }

      autoLoginSetupOpened.value = false;
    } else {
      try {
        await w3n.system.userLogin!.removeAutoLogin();
      } finally {
        updateAutoLoginRef();
      }
    }
  }

  updateAutoLoginRef();

  return {
    t,
    lang,
    colorTheme,
    changeColorTheme,

    allowShowingDevtool,
    changeAllowShowingDevtool,

    autoUpdate,
    toggleAutoUpdate,

    customLogoSrc,
    addCustomLogo,
    removeCustomLogo,

    autoLogin,
    autoLoginSetupOpened,
    changeAutoLogin,

    wipeDataFromDevice,
  };
}
