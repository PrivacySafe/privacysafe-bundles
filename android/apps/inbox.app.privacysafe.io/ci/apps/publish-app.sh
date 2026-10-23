#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/upload-utils.sh"
source "$this_dir/../utils/manifest-utils.sh"

version_file="$1"

app_domain="$(app_domain_from_manifest manifest.json)"
version="$(version_from_manifest manifest.json)"
echo $version > $version_file

pack_file="$(app_pack_name manifest.json).zip"
src_file="$(app_source_name manifest.json).zip"

upload_app_file() {
	ensure_upload_env_vars || return $?
	local app_domain="$1"
	local file_path="$2"
	if [ ! -e "$file_path" ]
	then
		echo "File $file_path is not found" 1>&2
		return $?
	fi
	local file="$(basename $file_path)"
	local version=$3
	local content=$4
	echo "Uploading $file as
	content: $content
	version: $version"
	local url="https://$SERVER/app/$app_domain/add-file?version=$version&file=$file&content=$content"
	curl --silent --show-error --fail --cacert "$SERVER_CERT" -X POST --header "X-Access-Token: $UPLOAD_TOKEN" --header "Content-Type: application/octet-stream" --data-binary "@$file_path" "$url" || return $?
}

upload_app_file $app_domain $pack_file $version bin/zip || exit $?

upload_app_file $app_domain $src_file $version src/zip || exit $?
