#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/manifest-utils.sh"

if [ -n "$1" ]
then
	init_dir=$(pwd)
	cd "$1"
fi

if [ ! -e "manifest.json" ]
then
	echo "Manifest file is not present in $(pwd)"
	exit 1
fi

if [ ! -d "app" ]
then
	echo "App directory is not present in $(pwd)"
	exit 1
fi

pack_name=$(app_pack_name manifest.json).zip

content="manifest.json app"

node "$this_dir/hash-content.cjs" $content > content.json || exit $?

zip -rq $pack_name $content content.json || exit $?

if [ -n "$init_dir" ]
then
	cd "$init_dir"
fi