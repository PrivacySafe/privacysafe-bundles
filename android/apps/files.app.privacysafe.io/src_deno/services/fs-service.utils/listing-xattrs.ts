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
import { isSafeRelativePath, isValidEntityName } from '../../../shared/utils/fs-utils/entity-name.ts';

/*
 Extended attributes come from storage that other apps and other devices can
 write to, so they are untrusted. Only the attributes below get into a listing
 entry, each one only with a value of the expected shape. Anything else is
 ignored, so an attribute can never replace a listing field like `fullPath`.
*/
const LISTING_XATTR_VALIDATORS = {
  parentFolder: (v: unknown) => isSafeRelativePath(v),
  originalName: (v: unknown) => isValidEntityName(v),
  thumbnail: (v: unknown) => isImageDataUrl(v),
  favoriteId: (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64,
  sync: (v: unknown) => typeof v === 'string',
  hidden: (v: unknown) => typeof v === 'string',
} as const;

export type ListingXAttrName = keyof typeof LISTING_XATTR_VALIDATORS;

export const LISTING_XATTRS = Object.keys(LISTING_XATTR_VALIDATORS) as ListingXAttrName[];

export function isListingXAttr(name: string): name is ListingXAttrName {
  return Object.hasOwn(LISTING_XATTR_VALIDATORS, name);
}

export function isValidListingXAttrValue(name: ListingXAttrName, value: unknown): boolean {
  return LISTING_XATTR_VALIDATORS[name](value);
}

export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' && /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

/*
 Attributes that the GUI may set through the RPC, with their value checks.
 The others are set only by the service itself (favorites, trash, ids of folders).
*/
const RPC_WRITABLE_XATTR_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  id: v => typeof v === 'string' && v.length > 0 && v.length <= 64,
  ext: v => typeof v === 'string' && v.length <= 64,
  mime: v => typeof v === 'string' && v.length <= 255,
  thumbnail: v => isImageDataUrl(v),
};

/** Keeps only the attributes the GUI is allowed to set, with valid values. */
export function filterRpcWritableXAttrs(attrs: Record<string, unknown>): {
  allowed: Record<string, unknown>;
  rejected: string[];
} {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    const validator = Object.hasOwn(RPC_WRITABLE_XATTR_VALIDATORS, name)
      ? RPC_WRITABLE_XATTR_VALIDATORS[name]
      : undefined;
    if (validator && validator(value)) {
      allowed[name] = value;
    } else {
      rejected.push(name);
    }
  }
  return { allowed, rejected };
}
