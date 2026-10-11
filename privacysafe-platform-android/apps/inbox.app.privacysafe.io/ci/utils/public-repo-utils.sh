#!/bin/bash

which_version_greater() {
	local local_version="$1"
	local remote_version="$2"
	node -e "
		const lv = '$local_version'.split('.').map(s => parseInt(s));
		const rv = '$remote_version'.split('.').map(s => parseInt(s));
		for (let i=0; i<3; i+=1) {
			const l = lv[i];
			const r = rv[i];
			if (isNaN(l) || isNaN(r)) {
				console.log('error');
				console.error('Bad app version: either local $local_version, or remote $remote_version');
				process.exit();
			}
			if (l > r) {
				console.log('local');
				process.exit();
			} else if (l < r) {
				console.log('remote');
				process.exit();
			}
		}
		console.log('equal');
	"
}

exit_if_no_push_needed_for_version() {
	local version="$1"
	local repo_version="$2"
	# compare versions, and exit when no push needed
	greater_version="$(which_version_greater "$version" "$repo_version")"
	if [ "$greater_version" == "remote" ] || [ "$greater_version" == "equal" ]
	then
		echo "No need to push"
		exit 0
	elif [ "$greater_version" != "local" ]
	then
		exit -1
	fi
}

get_repo_into() {
	local repo_url="$1"
	local repo_dir="$2"
	echo "Cloning repository from $repo_url into $repo_dir:"
	git clone $repo_url $repo_dir || return $?
}

ensure_git_env_vars() {
	if [ -z "$GIT_USER" ] || [ -z "$GIT_EMAIL" ] || [ -z "$GIT_TOKEN" ]
	then
		echo "Either git user name, email or access token are not set in environmental variables"
		return -1
	fi
}

config_git_user_here() {
	git config user.name $GIT_USER || return $?
	git config user.email $GIT_EMAIL || return $?
	git config credential.helper '!f() { sleep 1; echo "username=${GIT_USER}"; echo "password=${GIT_TOKEN}"; }; f' || return $?
}

push_repo_in() {
	ensure_git_env_vars || return $?
	local repo_dir="$1"
	local commit_msg="$2"
	(cd $repo_dir || exit $?
		config_git_user_here || exit $?
		git add . || exit $?
		git commit --message="$commit_msg" || exit $?
		git push || exit $?
	) || return $?
}

push_repo_version_in() {
	ensure_git_env_vars || return $?
	local version="$1"
	local repo_dir="$2"
	local commit_msg="$3"
	local tag_msg="$4"
	(cd $repo_dir || exit $?
		config_git_user_here || exit $?
		git add . || exit $?
		git commit --message="$commit_msg" || exit $?
		git tag -a "v$version" -m "$tag_msg" || exit $?
		git push --follow-tags || exit $?
	) || return $?
}

push_content_into_repo() {
	repo_url="$1"
	src_dir="$2"
	version="$3"

	repo_dir="$(mktemp -d -t sync-repo-dst-XXXXXXXX)"
	get_repo_into $repo_url $repo_dir || return $?

	echo "Cleaning original repo content and moving (mv) all from source $src_dir"
	for entity in $(ls -a  --ignore=. --ignore=.. --ignore=.git $repo_dir)
	do
		rm -rf "$repo_dir/$entity" || return $?
	done
	mv $src_dir/* $src_dir/.[!.]* $repo_dir/ || return $?

	push_repo_version_in "$version" $repo_dir "v$version" "Version $version" || return $?

	rm -r $repo_dir
}


	############
	# Codeberg #
	############

cb_repo_url_of() {
	local repo_name="$1"
	echo "https://codeberg.org/PrivacySafe/$repo_name.git"
}

cb_repo_file_url() {
	local repo_name="$1"
	local file_path="$2"
	# working with main branch only
	echo "https://codeberg.org/PrivacySafe/$repo_name/raw/branch/main/$file_path"
}


	##########
	# Github #
	##########

gh_repo_url_of() {
	local repo_name="$1"
	echo "https://github.com/PrivacySafe/$repo_name.git"
}

gh_repo_file_url() {
	local repo_name="$1"
	local file_path="$2"
	# working with main branch only
	echo "https://raw.githubusercontent.com/PrivacySafe/$repo_name/main/$file_path"
}
