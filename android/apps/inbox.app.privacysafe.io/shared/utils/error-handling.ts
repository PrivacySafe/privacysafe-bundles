/*
 Copyright (C) 2024 3NSoft Inc.

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

export function setupGlobalReportingOfUnhandledErrors(
  skipDefaultHandling = false,
): void {
  self.onunhandledrejection = ev => {
    w3n.log('error', `Captured unhandled promise rejection/error event`, ev.reason);
    if (skipDefaultHandling) {
      ev.preventDefault();
    }
  };

  self.onerror = ev => {
    if (typeof ev === 'string') {
      w3n.log('error', `Captured unhandled error event (string value)`, ev);
    } else {
      w3n.log('error', `Captured unhandled error event`, (ev as any).error);
      if (skipDefaultHandling) {
        ev.preventDefault();
      }
    }
  };
}
