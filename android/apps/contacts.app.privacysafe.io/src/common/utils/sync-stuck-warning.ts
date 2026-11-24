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

/**
 * The i18n key of the standing warning shown for a sync:stuck event, by its
 * reason. The remedies differ, so the words do too:
 *  - root-folder-not-verified: the server does not answer. Nothing to do but
 *    wait; a restart helps only if the server is back and the platform's
 *    cached failed login keeps the session from recovering.
 *  - local-version-not-published: the server refuses the changes, and only a
 *    restart resumes publishing them.
 */
export function syncStuckWarningKey(reason?: string): string {
  switch (reason) {
    case 'root-folder-not-verified':
      return 'app.warning.server-unreachable';
    case 'local-version-not-published':
      return 'app.warning.changes-not-published';
    default:
      return 'app.warning.sync-stuck';
  }
}
