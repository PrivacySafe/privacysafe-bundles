# Bundle tools

This `tools/` folder contains scripts to get all parts of some given bundle. Platform and apps are pulled from respective version tags in either `github` or `codeberg` (lowcasing as value for script).

Note that folders `apps/` and `android/` at each point contain source for latest android bundle. These are updated by script so as to have source related to release for [F-Droid](https://f-droid.org/) and other automated processes.

In a manual mode, one may do the following:
```
# pull bundle's source from repo's
$ bash collect-bundle-source.sh bundles/[android|desktop]/[bundle-info-file] [github|codeberg]

# For Android bundle:

#  - prepare/compile and copy apps' code, and non-java/kotlin parts of platform
$ bash prep-before-android-build.sh

#  - build debug, cause release needs signing keys setup
$ bash build-android-debug.sh
```

Android releases are done with keys, of course:
- direct `apk` is created for [F-Droid](https://f-droid.org/) and [Obtainium](https://obtainium.imranr.dev/).
- `aab` with respective mappings are fed to [Google Play](https://play.google.com/store/apps/details?id=app.privacysafe).
- `apks` is created from `aab` for [Accrescent](https://accrescent.app/), following their instructions.
