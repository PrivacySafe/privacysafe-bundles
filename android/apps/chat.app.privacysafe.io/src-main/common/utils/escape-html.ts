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

const replacements: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Text as HTML that shows exactly that text. For values put into a translation
 * that is then rendered as HTML (v-ui3n-html): vue-i18n does not escape
 * parameters, and a chat name is chosen by whoever sent the invitation.
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, c => replacements[c]);
}
