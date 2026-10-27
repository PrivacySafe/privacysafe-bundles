# Extended attributes

Extended attributes (xattrs) of files and folders that the app writes and reads. They are stored in the user storages and synchronized with them; the device storage has no xattrs.

| Attribute | Entity | Written by | Meaning |
|---|---|---|---|
| `id` | folder / file | Deno on folder creation; GUI on upload (via RPC) | ID of the entity in listings |
| `ext` | file | GUI on upload | file extension detected from the content |
| `mime` | file | GUI on upload | MIME type detected from the content |
| `thumbnail` | file | GUI on upload | thumbnail as a `data:image/…;base64,…` URL |
| `favoriteId` | folder | Deno when a folder is marked as favorite | ID of the favorite in `favorites.data` |
| `parentFolder` | folder / file in the trash | Deno on deletion to the trash | the folder to restore the entity into; set only on entities directly in the trash, removed on restore |
| `originalName` | folder / file in the trash | Deno on deletion to the trash | the name to restore the entity with; removed on restore |
| `tags` | folder / file | — (read only) | tags of the entity |
| `cached-hashes` | file | GUI after computing a hash | SHA-256 / SHA-512 of the content with its `mtime` and size; ignored when they no longer match the file |

## Validation

Xattrs can be written by other apps and come from other devices, so they are untrusted ([listing-xattrs.ts](../src_deno/services/fs-service.utils/listing-xattrs.ts)):

- a listing entry gets only `parentFolder`, `originalName`, `thumbnail`, `favoriteId`, `tags`, `sync` and `hidden`, each one only with a value of the expected shape; other xattrs are ignored and can never replace fields like `fullPath`;
- through the `updateEntityXAttrs` RPC method the GUI may set only `id`, `ext`, `mime` and `thumbnail`;
- on restore, an invalid `parentFolder` or `originalName` is replaced by the root folder and the name in the trash.
