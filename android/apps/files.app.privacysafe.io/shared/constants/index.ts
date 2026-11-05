export * from './app-info.ts';

/** The side of a custom icon of an entity (xattr `icon`), in pixels: crisp at 100 px. */
export const ENTITY_ICON_SIZE = 128;
/** The largest custom icon data URL: a 128×128 WebP is a few KB, and an icon is read with every listing entry. */
export const ENTITY_ICON_MAX_LENGTH = 64 * 1024;
