# Source and Build Provenance

This repository primarily publishes PrivacySafe application bundles and release
artifacts. It is **not** the canonical source-code repository for the software
inside those bundles.

For every distributed PrivacySafe bundle, release metadata should identify the
corresponding complete source and the build from which the artifact was
produced. This is important for software-freedom compliance, reproducibility,
independent review, and downstream distributors such as
[F-Droid](https://f-droid.org/).

## Required release provenance

For each bundle, record or link:

- PrivacySafe product/component name;
- version name;
- Android `versionCode`, where applicable;
- target platform and ABI, such as `arm64-v8a`;
- bundle filename;
- SHA-256 checksum;
- canonical source repository URL;
- exact source tag or commit used for the build;
- build instructions or build-system entry point;
- applicable license identifier(s);
- required third-party notices or license files;
- signing/distribution context where useful for verification.

## Release entry template

```text
Product: PrivacySafe
Version: <version>
Android versionCode: <integer>
Platform / ABI: Android / arm64-v8a
Artifact: <filename>
SHA-256: <checksum>
Source: <canonical source repository URL>
Source revision: <tag or commit>
Build instructions: <URL or repository path>
License: AGPL-3.0-or-later, except third-party components as noted
Third-party notices: <URL or repository path>
```

## Corresponding source

When a binary or other object-code artifact is distributed under the GNU Affero
General Public License, the release process must preserve the source and license
information required by the applicable license terms. Do not assume that the
presence of a binary in this repository is itself sufficient source
availability.

The preferred practice for this repository is to make the exact corresponding
source revision directly discoverable from the same release or its metadata.

PrivacySafe source repositories are published under:

- https://github.com/PrivacySafe

PrivacySafe nightly Android builds are published at:

- https://download.privacysafe.app/nightly/android/

## Third-party components

Do not replace third-party notices with the PrivacySafe or Ivy Cyber copyright
statement. Preserve upstream copyright, license, and attribution requirements
for components included in published bundles.

Where a bundle contains third-party code under another compatible license, keep
its required notices with the source/build materials and, where appropriate,
reference them from this repository's `NOTICE` or `LICENSES` information.
