#!/bin/bash

source "$(dirname "${BASH_SOURCE[0]}")/../utils/manifest-utils.sh"

src_file=$(app_source_name manifest.json).zip

to_zip="$@"

if [ -z "$to_zip" ]
then
	echo "No files/folders given to pack into sources"
	exit 1
else
	for elem in $to_zip
	do
		if [ ! -e $elem ]
		then
			echo "$elem is not found"
			exit 1
		fi
	done
fi

zip -rq $src_file $to_zip || exit $?
