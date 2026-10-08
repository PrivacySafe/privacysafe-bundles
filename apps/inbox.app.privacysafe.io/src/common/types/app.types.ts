import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import type { PreparedMessageData } from './mail.types';

export type AvailableLanguage = 'en';

export type ConnectivityStatus = 'offline' | 'online';

export interface AppConfig {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  customLogo?: string;
}

export interface AppConfigsInternal {
  getSettingsFile: () => Promise<AppSettings>;
  saveSettingsFile: (data: AppSettings) => Promise<void>;
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
}

export interface AppConfigs {
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
  watchConfig(obs: web3n.Observer<AppConfig>): () => void;
}

export interface SettingsJSON {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
}

export interface AppSettings {
  currentConfig: SettingsJSON;
}

export interface AppState {
  lastReceivingTimestamp: number;
}

/**
 * What the avatar menu can ask for. One list for the desktop menu and the phone
 * drawer, so the two cannot drift apart in what they offer.
 */
export type AppMenuAction = 'refresh' | 'manage-blocks' | 'make-backup' | 'restore-backup' | 'exit';

export interface AppMenuItem {
  id: AppMenuAction;
  icon: string;
  label: string;
  /**
   * Shown in the warning colour, as the same action is in chat.app: this one is
   * about a person rather than about this app's own data.
   */
  isAccent?: boolean;
}

export interface AppGlobalEvents {
  'resize-app': void;
  'run-create-message': { data: PreparedMessageData, isThisReplyOrForward?: boolean, sourceFolder?: string };
  'sending-complete': { id: string; status: 'ok' | 'error' };
  'open-inbox-msg': { msgId: string };
}

