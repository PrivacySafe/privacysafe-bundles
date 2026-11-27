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
export function htmlToText({ value, length = 150 }: { value?: string; length?: number }): string {
  if (!value) {return '';}

  // Parsed into a document of its own, never into an element of the window's.
  // An element created by `document` - attached or not - starts loading an
  // <img> as soon as it is parsed, so `<img src=x onerror=...>` in a received
  // mail ran its handler in this window the moment the message list showed it,
  // without the user opening anything (audit of 2026-11-26). A DOMParser
  // document runs no scripts and loads nothing.
  const doc = new DOMParser().parseFromString(value, 'text/html');
  const text = doc.body?.textContent || '';
  return text.slice(0, length);
}
