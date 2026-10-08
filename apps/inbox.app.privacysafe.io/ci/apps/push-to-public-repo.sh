#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/manifest-utils.sh"
source "$this_dir/../utils/public-repo-utils.sh"

pub_site="$1"

ensure_git_env_vars || exit $?

# unzip app source
src_dir="$(mktemp -d -t app-repo-src-XXXXXXXX)"
for fname in $(ls .)
do
	case "$fname" in
		*-src.zip)
			unzip -q "$fname" -d "$src_dir" || exit $?
			break ;;
		*) ;;
	esac
done

app="$(app_domain_from_manifest $src_dir/manifest.json)"
if [ "$app" == "$APP_DOMAIN" ]
then
	echo "$app 3NWeb app"
else
	echo "App domain from manifest is $app while exected from environment is $APP_DOMAIN and they don't match"
	exit -1
fi

version="$(version_from_manifest $src_dir/manifest.json)"
echo "local version is $version"

if [ "$pub_site" == "github" ]
then
	site_manifest_url="$(gh_repo_file_url $app manifest.json)"
	repo_url="$(gh_repo_url_of $app)"
elif [ "$pub_site" == "codeberg" ]
then
	site_manifest_url="$(cb_repo_file_url $app manifest.json)"
	repo_url="$(cb_repo_url_of $app)"
else
	echo "Unrecognized public site: $pub_site"
	exit -1
fi

repo_version="$(get_from_remote_json "$site_manifest_url" version)"
echo "$pub_site's version is $repo_version"

exit_if_no_push_needed_for_version "$version" "$repo_version"

push_content_into_repo "$repo_url" "$src_dir" "$version" || exit $?

rm -r $src_dir
