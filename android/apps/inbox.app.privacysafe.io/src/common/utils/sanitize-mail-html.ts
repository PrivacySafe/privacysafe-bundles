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
import sanitizeHtml from 'sanitize-html';

const MAIL_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedClasses: {
    '*': [
      'te-font-12',
      'te-font-18',
      'te-font-24',
      'te-font-32',
      'align-left',
      'align-right',
      'align-center',
      'align-justify',
    ],
  },
};

/**
 * A mail body as HTML that is safe to put into this app's DOM: the same rules
 * as the reading view (sanitize-html defaults - no img, style, form, script or
 * event handlers - plus the editor's own classes).
 *
 * Every place that puts a received body into markup goes through this: the
 * reading view, the report dialog, the quote of a reply or forward. A body is
 * written by its sender, and one of those places without it is enough to run
 * the sender's script in the window (audit of 2026-11-26).
 */
export function sanitizeMailHtml(html: string | undefined | null): string {
  return html ? sanitizeHtml(html, MAIL_HTML_OPTIONS) : '';
}
