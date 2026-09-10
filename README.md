<p align="center">
  <a href="https://privacysafe.app"><img src="privacysafe_logo.svg" width="600" alt="PrivacySafe" /></a>
</p>

# PrivacySafe Bundles

Published PrivacySafe application bundles, release artifacts, and related distribution information.

## Overview

This repository provides published PrivacySafe bundles and release materials in a simple, inspectable location.

It is intended primarily to provide a source for **Android builds and release artifacts**, including material that can be inspected by users, downstream distributors, and alternative or replacement app stores such as [F-Droid](https://f-droid.org/).

PrivacySafe's canonical application ID for Android is:

```text
app.privacysafe
```

PrivacySafe is Free/Libre and Open Source Software (FLOSS). This repository is part of the project's public distribution infrastructure and is not intended to replace the upstream source repositories used to build PrivacySafe.

## Bundles and releases

Published artifacts are stored under [`bundles/`](bundles/).

GitHub Releases may also be used to provide versioned release artifacts and release metadata.

Where practical, releases should make it easy to identify:

- the PrivacySafe version;
- the target platform;
- the Android ABI or architecture, where applicable;
- the corresponding source revision;
- checksums or other integrity information;
- any information needed by downstream distributors to review the release.

For Android, architecture names should follow Android ABI terminology where applicable, for example:

```text
arm64-v8a
```

## Android and alternative app stores

One of the primary purposes of this repository is to make PrivacySafe Android release material easy to locate and inspect outside Google Play.

This includes supporting review by alternative app stores and downstream distributors such as [F-Droid](https://f-droid.org/), as well as users who prefer to inspect or obtain PrivacySafe through Free Software distribution channels.

F-Droid and similar projects may build applications from source according to their own reproducibility, metadata, signing, and inclusion requirements. Artifacts published here are therefore provided as release and distribution references; they do not by themselves imply acceptance by or publication through any particular third-party app store.

For PrivacySafe nightly Android builds, see:

**https://download.privacysafe.app/nightly/android/**

For the main PrivacySafe project and downloads, see:

**https://privacysafe.app/**

## Source code

PrivacySafe client and server software is developed as Free/Libre and Open Source Software.

Project source code is published through the PrivacySafe organization:

- [PrivacySafe on GitHub](https://github.com/PrivacySafe)
- [PrivacySafe website](https://privacysafe.app/)
- [PrivacySafe Foundation](https://privacysafe.foundation/)

Release artifacts in this repository should be traceable to the corresponding source wherever practical.

## Integrity and reproducibility

Published release artifacts should be accompanied by checksums or equivalent integrity information when available.

Downstream distributors and users should verify release artifacts before relying on them. Where reproducible-build information is available, it should be published alongside or linked from the relevant release.

This repository must never contain private signing keys, passwords, recovery material, access tokens, or other release secrets.

## 🤝 Contributing

Contributions that improve release metadata, documentation, reproducibility, packaging, or downstream distribution are welcome.

Please keep pull requests focused and avoid committing generated or unrelated artifacts that are not part of the published PrivacySafe release process.

Never send sensitive information about yourself or other users through ordinary issue comments, pull requests, or unencrypted email.

Security vulnerabilities should be reported through the project's published security-reporting process rather than through a public issue.

## 🏛️ PrivacySafe Foundation

[PrivacySafe Foundation](https://privacysafe.foundation/) is a 501(c)(3) nonprofit public charity supporting Free/Libre and Open Source Software (FLOSS), cybersecurity education, decentralized technology, documentation, standards work, and public-interest privacy and security research.

PrivacySafe products and services are published and provided by [Ivy Cyber LLC](https://ivycyber.com/), with development support from PrivacySafe Foundation.

## ⚖️ License

Copyright © 2026 [Ivy Cyber LLC](https://ivycyber.com/).

Unless otherwise noted, original software and source materials in this repository are licensed under the [GNU Affero General Public License version 3 or later](https://www.gnu.org/licenses/agpl-3.0.html) (`AGPL-3.0-or-later`).

Third-party components and redistributed artifacts retain their original copyrights and licenses. Their applicable license terms take precedence for those components.

PrivacySafe® and 3NWeb® are registered trademarks. PrivacySafe Foundation™ and Ivy Cyber™ are pending trademarks. Other product, service, technology, and organization names, logos, and marks may also be protected by applicable trademark and unfair competition law.

Free software licenses do not grant trademark rights.
