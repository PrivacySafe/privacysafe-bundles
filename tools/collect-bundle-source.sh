#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"

bundle_info_file="$1"
cat "$bundle_info_file" > /dev/null || exit $?

public_site="$2"
if [ "$public_site" == "codeberg" ]
then
	base_url="https://codeberg.org/PrivacySafe"
elif [ "$public_site" == "github" ]
then
	base_url="https://github.com/PrivacySafe"
else
	echo "Unknown public site $pub_site"
	exit -1
fi

info() {
	jq -r $@ $bundle_info_file
}

type=$(info .type)
if [ "$type" != "android" ] && [ "$type" != "desktop" ]
then
	echo "Can't get bundle $type from file $bundle_info_file"
	exit -1
fi

download_from() {
	local repo="$1"
	local version="$2"
	local dst="$3"
	local repo_url="$base_url/$repo.git"
	echo
	echo " 📥  Downloading $repo tag $version from repository $repo_url into $dst"
	git clone --branch "$version" "$repo_url" "$dst" || return $?
	rm -rf "$dst/.git" "$dst/.gitignore" || return $?
	echo " 📂 $repo is in $dst"
}

mkdir_clean() {
	local dir="$1"
	if [ -d "$dir" ]
	then
		rm -rf $dir || return $?
	fi
	mkdir -p "$dir" || return $?
}

echo "  1️⃣  PrivacySafe $type platform"
platform_dir="$type"
mkdir_clean "$platform_dir"  || exit $?
if [ "$type" == "android" ]
then
	platform_repo="privacysafe-platform-android"
	download_from "$platform_repo" "v$(info .platform)" "$platform_dir" || exit $?
	echo "$(info .versionName)" > $platform_dir/app/version-name
	echo "$(info .versionCode)" > $platform_dir/app/version-code
	echo "true" > $platform_dir/app/enable-r8-minifications || exit $?
elif [ "$type" == "desktop" ]
then
	platform_repo="privacysafe-platform-electron"
	download_from "$platform_repo" "v$(info .platform)" "$platform_dir" || exit $?
fi
cat "$bundle_info_file" > "$platform_dir/bundle-info.json"

echo
echo "  2️⃣  system 3NWeb apps"
for app in $(info .apps | jq -r keys[])
do
	app_version="$(info .apps[\"$app\"])"
	app_dir="apps/$app"
	mkdir_clean "$app_dir" || exit $?
	download_from "$app" "v$app_version" "$app_dir" || exit $?
done

echo
echo "  3️⃣  bundled 3NWeb apps"
for app in $(info '."app-packs"' | jq -r keys[])
do
	app_version="$(info ".\"app-packs\"[\"$app\"]")"
	app_dir="apps/$app"
	mkdir_clean "$app_dir" || exit $?
	download_from "$app" "v$app_version" "$app_dir" || exit $?
done

cat "$bundle_info_file" > "apps/bundle-info.json"

echo
echo " ℹ️  $platform_dir and apps folders now have source for bundle, referenced by bundle-info.json files in respective folders."
if [ "$type" == "android" ]
then
	echo "Now you can run tools/build-android-bundle.sh to build apps and android platform bundling it with apps."
fi