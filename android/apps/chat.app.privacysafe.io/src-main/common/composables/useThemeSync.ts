/*
 Copyright (C) 2026 3NSoft Inc.

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
import { inject, watch } from 'vue';
import type { Ref } from 'vue';
import { THEME_KEY, type ThemeId, type ThemePlugin } from '@v1nt1248/3nclient-lib/plugins';

/**
 * Ties the theme id the launcher published to the library's theme plugin,
 * which is what puts classes on <html>. Used by all four windows - the main
 * one and both call windows - so that none of them applies a theme its own
 * way.
 *
 * Fires immediately with whatever the store holds at setup time (the default),
 * and again once readAndStartWatchingAppConfig brings the real value in, and
 * on every later change of the launcher's settings file.
 */
export function useThemeSync(colorTheme: Ref<ThemeId>): void {
  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;
  watch(colorTheme, id => setTheme(id), { immediate: true });
}
