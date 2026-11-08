# Storage app for the 3NWeb platform

A file manager for the encrypted storage of the [PrivacySafe](https://privacysafe.app) platform (3NWeb). It works with the user's synced storage (kept on the 3N server and synchronized between devices), the local storage and device folders, and implements the platform's file dialogs for other apps.

App domain: `files.app.privacysafe.io`. License: AGPL-3.0-or-later.

## Architecture

The app consists of four component types declared in [manifest.json](manifest.json):

| Component | Code | Runtime | What it does |
|---|---|---|---|
| `/index.html` | [src/](src/) | web GUI (Vue 3, Pinia) | the file manager window |
| `/index-file-picker.html`, `/index-file-picker-mobile.html` | [src-file-picker/](src-file-picker/) | web GUI | the system file dialogs (`w3n.shell.fileDialogs.*`), opened for other apps |
| `/storageDenoServices.js` | [src_deno/](src_deno/) | Deno | the storage service: FS operations, trash, favorites, synchronization |

Code shared by the GUI and the Deno service lives in [shared/](shared/); the platform API typings are in [@types/](@types/).

```
 GUI (src/) ───── RPC "AppStorageInternal" ────┐
                                               ├──> Deno service (src_deno/) ──> 3N FS (w3n.storage)
 file pickers ─── RPC "AppStoragePicker" ──────┘        └─ sync queue, watchers, favorites
 (src-file-picker/)   read-only methods
```

- The GUI calls the service through `appStorageSrv` ([src/services/services-provider.ts](src/services/services-provider.ts)); the methods are defined in [src_deno/index.ts](src_deno/index.ts) and typed in [src_deno/types.ts](src_deno/types.ts). The service also streams events to the GUI (`watchEvent`): sync progress, conflicts, favorites, connectivity.
- The pickers run as dialogs of other apps, so they get a separate service with only three read-only methods (`PICKER_SERVICE_METHODS`).
- Synchronization of the user synced storage is driven by a queue in the Deno service: [doc/sync-life-cycle.md](doc/sync-life-cycle.md). Extended attributes used by the app: [doc/x-attrs.md](doc/x-attrs.md).

## Development

Requirements: Node.js 24, pnpm (see `packageManager` in [package.json](package.json)), Deno 2, and a PrivacySafe platform build with the test stand.

```bash
pnpm install
```

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server for the GUI and the pickers on http://localhost:3030 |
| `pnpm build` | lint, type check and production build into `app/` (GUI + Deno service) |
| `pnpm build:deno` | bundle only the Deno service into `app/storageDenoServices.js` |
| `pnpm test` / `pnpm test:watch` | unit tests (Vitest) |
| `pnpm check:deno` | type check the Deno service (`deno check`) |
| `pnpm lint` / `pnpm linter:fix` | ESLint and Stylelint over all sources |

### Running in the platform test stand

1. Copy [test-setup.example.json](test-setup.example.json) to `test-setup.json` and create `test-users-creds.json` with the test user credentials (both files are ignored by git).
2. Put `setup-w3n.bundle.js` from the platform build into the repository root (also ignored). In production the platform serves this script itself; in development the page is loaded from the Vite server and needs a local copy.
3. Build the Deno service: `pnpm build:deno`. **The test stand loads the Deno component from `app/`**, not from the dev server, so changes in `src_deno/` or `shared/` take effect only after this command.
4. Start the GUI: `pnpm dev`.
5. Start the platform: `./run-test-mac.sh <path to PrivacySafe.app>` on macOS or `./run-test.sh <path to the platform binary>`. The data of the test users is kept in `../../mock-data`.

## Tests

Unit tests are in [tests/unit/](tests/unit/):

- [tests/unit/deno/](tests/unit/deno/) — the Deno service: FS operations, the RPC facade of `src_deno/index.ts` (with mocked platform services), the sync queue, favorites;
- [tests/unit/shared/](tests/unit/shared/) — shared utilities;
- [tests/unit/gui/](tests/unit/gui/) — GUI logic that does not need mounted components;
- [tests/unit/manifest.spec.ts](tests/unit/manifest.spec.ts) — consistency of the manifest.

FS operations run against [an in-memory FS](tests/unit/helpers/memory-fs.ts) that follows the behaviour of the platform FS (path normalization, `alreadyExists` / `notFound` errors, data copied on read and write).

CI ([.gitlab-ci.yml](.gitlab-ci.yml)) runs `pnpm check:deno`, `pnpm test` and `pnpm build`.
