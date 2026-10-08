/*
 Copyright (C) 2020-2025 3NSoft Inc.

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
import { Alignment, Side } from 'driver.js';
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';

export type AvailableLanguage = 'en';

export interface AppConfig {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  customLogo?: string;
}

export type ConnectivityStatus = 'offline' | 'online';

/** What the app menu can ask for. Shared by the desktop and the mobile menu. */
export type AppMenuAction = 'tutorial' | 'make-backup' | 'upload-backup' | 'exit';

export interface TutorialStep {
  elQuery: string;
  text: string;
  side?: Side;
  alignment?: Alignment;
  isRound?: boolean;
  onNextAction?: () => void | Promise<void>;
}

/** Serializable form of a step: `onNextAction` cannot be persisted. */
export type TutorialStepData = Omit<TutorialStep, 'onNextAction'>;

/** Persisted tutorial state stored in the app local FS. */
export interface TutorialState {
  isActive: boolean;
  remainingSteps: TutorialStepData[];
}
