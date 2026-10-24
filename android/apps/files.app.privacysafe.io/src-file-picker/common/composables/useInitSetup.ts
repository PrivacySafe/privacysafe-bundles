import { inject, onBeforeMount, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { THEME_KEY, type ThemePlugin } from '@v1nt1248/3nclient-lib/plugins';
import { SystemSettings, getActiveTheme } from '@/utils/ui-settings';
import type { AvailableLanguage } from '@shared/types';

/**
 * Loads app config (lang, theme) and subscribes to live changes.
 *
 * The picker is a standalone component, launched by other apps, so it reads
 * ui-settings on its own and doesn't touch the main app's store.
 */
export function useInitSetup() {
  const { locale } = useI18n();
  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;

  let unwatch: (() => void) | undefined;

  function applyLang(lang: AvailableLanguage) {
    locale.value = lang;
  }

  onBeforeMount(async () => {
    try {
      const config = await SystemSettings.makeResourceReader();
      const { lang, colorTheme } = await config.getAll();
      applyLang(lang);
      setTheme(getActiveTheme(colorTheme));

      // watchConfig's return value IS the unsubscribe fn...not a
      // subscription object. See shared/types/app.types.ts AppConfigs.
      unwatch = config.watchConfig({
        next: appConfig => {
          const { lang, colorTheme } = appConfig;
          applyLang(lang);
          setTheme(getActiveTheme(colorTheme));
        },
      });
    } catch (e) {
      // UI settings are non-fatal for the picker. Keep the current/default
      // configuration and allow file selection to remain available.
      console.error('🔥 Error while loading picker app config. ', e);
    }
  });

  onBeforeUnmount(() => {
    unwatch?.();
  });
}
