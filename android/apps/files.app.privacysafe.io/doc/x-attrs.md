# Extended attributes

Extended attributes (xattrs) of files and folders that the app writes and reads. They are stored in the user storages and synchronized with them; the device storage has no xattrs.

| Attribute | Entity | Written by | Meaning |
|---|---|---|---|
| `id` | folder / file | Deno on folder creation; GUI on upload (via RPC) | ID of the entity in listings |
| `ext` | file | GUI on upload | file extension detected from the content |
| `mime` | file | GUI on upload | MIME type detected from the content |
| `thumbnail` | file | GUI on upload | thumbnail as a `data:image/…;base64,…` URL |
| `icon` | folder / file / link | GUI, the icon editor (info panel, tile) | custom icon chosen by the user: a 128×128 WebP (PNG if WebP cannot be encoded) `data:` URL, at most 64 KB; shown instead of the thumbnail and the type icon. For a link it is kept in the link itself, not in its target |
| `favoriteId` | folder | Deno when a folder is marked as favorite | ID of the favorite in `favorites.data` |
| `parentFolder` | folder / file in the trash | Deno on deletion to the trash | the folder to restore the entity into; set only on entities directly in the trash, removed on restore |
| `originalName` | folder / file in the trash | Deno on deletion to the trash | the name to restore the entity with; removed on restore |
| `tags` | folder / file | — (read only) | tags of the entity |
| `cached-hashes` | file | — (no longer written or read since 05.11.2026) | SHA-256 / SHA-512 of the content; may remain on files hashed before. A write of xattrs is a new version of the file and its upload, so hashes are computed on request only |

## Validation

Xattrs can be written by other apps and come from other devices, so they are untrusted ([listing-xattrs.ts](../src_deno/services/fs-service.utils/listing-xattrs.ts)):

- a listing entry gets only `parentFolder`, `originalName`, `thumbnail`, `favoriteId`, `tags`, `sync` and `hidden`, each one only with a value of the expected shape; other xattrs are ignored and can never replace fields like `fullPath`;
- through the `updateEntityXAttrs` RPC method the GUI may set only `id`, `ext`, `mime` and `thumbnail`;
- on restore, an invalid `parentFolder` or `originalName` is replaced by the root folder and the name in the trash.
