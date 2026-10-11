/*
 Copyright (C) 2025 3NSoft Inc.

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

/**
 * Time duration constants for auto-delete message settings.
 * Values are in milliseconds.
 */
export const AUTODELETE_OFF = 0;
export const ONE_YEAR = 31557600000; // 365.25 days
export const ONE_MONTH = 2629800000; // 30.475 days
export const ONE_WEEK = 604800000;
export const ONE_DAY = 86400000;
export const ONE_HOUR = 3600000;
export const ONE_MINUTE = 60000;

/**
 * Auto-delete message duration options.
 * Keys are string IDs ('0'-'5') used in chat settings.
 * Each option contains:
 * - value: duration in milliseconds (0 = off)
 * - label: i18n key for UI display
 */
export const AUTO_DELETE_MESSAGES_BY_ID = {
  '0': {
    value: AUTODELETE_OFF, // off
    label: 'chat.action.menu.txt.timer.0',
  },
  '1': {
    value: ONE_YEAR, // 1 year
    label: 'chat.action.menu.txt.timer.1',
  },
  '2': {
    value: ONE_MONTH, // 1 month
    label: 'chat.action.menu.txt.timer.2',
  },
  '3': {
    value: ONE_WEEK, // 1 week
    label: 'chat.action.menu.txt.timer.3',
  },
  '4': {
    value: ONE_DAY, // 1 day
    label: 'chat.action.menu.txt.timer.4',
  },
  '5': {
    value: ONE_HOUR, // 1 hour
    label: 'chat.action.menu.txt.timer.5',
  },
} as const;

export type AutoDeleteOptionId = keyof typeof AUTO_DELETE_MESSAGES_BY_ID;