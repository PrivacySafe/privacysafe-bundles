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
import type { ListingEntryExtended } from '@shared/types';

/** The icon of an entity type; a link gets the icon of its target, a broken link the alert one. */
export function getFsEntityTypeIcon(type: ListingEntryExtended['type']): string {
  if (type === 'folder' || type === 'link-folder') {
    return 'round-folder';
  }

  if (type === 'file' || type === 'link-file') {
    return 'round-subject';
  }

  return 'data-alert';
}

export function isLinkEntityType(type: ListingEntryExtended['type']): boolean {
  return type === 'link-folder' || type === 'link-file' || type === 'link-broken';
}
