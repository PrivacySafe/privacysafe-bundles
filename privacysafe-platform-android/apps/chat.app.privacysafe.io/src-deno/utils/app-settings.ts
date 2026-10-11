/*
 Copyright (C) 2025-2026 3NSoft Inc.

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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { en } from '../../src-main/common/data/i18/en.ts';
import type { SettingsJSON } from '../../types/app.types.ts';

const LANGUAGE_BY_FILE: Record<string, Record<string, any>> = {
  en,
};

export class AppSettings {
  private file: web3n.files.File | undefined = undefined;
  private lang = 'en';

  constructor() {
    this.makeResourceReader();
  }

  private async makeResourceReader() {
    this.file = (await w3n.shell!.getFSResource!(
      'launcher.app.privacysafe.io',
      'ui-settings',
    )) as web3n.files.ReadonlyFile;
  }

  async getCurrentLanguage() {
    if (!this.file) {
      await this.makeResourceReader();
    }

    const { lang } = await this.file!.readJSON<SettingsJSON>();
    this.lang = lang;
    return lang;
  }

  async t(key: string, placeholders?: Record<string, string>): Promise<string | undefined> {
    await this.getCurrentLanguage();
    const currentLanguageFile = LANGUAGE_BY_FILE[this.lang] || en;

    const keys = key.split('.');
    let value: any = { ...currentLanguageFile };
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    if (placeholders) {
      return value.replace(/{(\w+)}/g, (match, pKey) => {
        return pKey in placeholders ? placeholders[pKey] : match;
      });
    }

    return value;
  }
}
