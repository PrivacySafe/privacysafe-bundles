# SPDX and REUSE-style headers

Use SPDX identifiers wherever the file format supports comments without affecting behavior.

## Software

JavaScript / TypeScript / Java / Kotlin / Rust / C / C++:

```text
// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
```

Shell / Python / YAML (when comments are permitted):

```text
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
```

HTML / XML:

```html
<!--
SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
SPDX-License-Identifier: AGPL-3.0-or-later
-->
```

CSS:

```css
/*
 * SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
```

## Documentation

Markdown:

```html
<!--
SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
SPDX-License-Identifier: Apache-2.0
-->
```

Documentation may additionally identify contributors:

```text
Contributors: Mikalai Birukou <mb@3nsoft.com>; Sean O'Brien <sean@ivycyber.com>; 3NSoft, Inc. <https://3nsoft.com>; PrivacySafe Foundation, Inc. <https://privacysafe.foundation>; Ivy Cyber LLC <https://ivycyber.com>
```

## Third-party files

Do not replace an upstream SPDX identifier merely to make the repository uniform. Preserve the upstream license and copyright notice. If the file is modified, add a separate modification notice only when appropriate.

Generated files, lockfiles, vendored code, binaries, media, fonts, and files that cannot safely carry comments should be documented with `REUSE.toml`, `.reuse/dep5`, `NOTICE`, or an equivalent machine-readable mechanism rather than being modified blindly.
