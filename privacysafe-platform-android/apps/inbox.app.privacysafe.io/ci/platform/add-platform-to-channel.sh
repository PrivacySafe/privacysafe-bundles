#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/upload-utils.sh"

brand="$1"
os="$2"
version="$3"
channel="$4"

if [ -z "$channel" ]
then
	echo "missing channel"
fi

echo "---------- Task overview ----------------
This adds $brand $os platform version $version to $channel channel.
-----------------------------------------
"

ensure_upload_env_vars || exit $?

url="https://$SERVER/platform/${brand}/${channel}/add?version=$version&os=$os"

curl --silent --show-error --fail --cacert "$SERVER_CERT" -X POST --header "X-Access-Token: $UPLOAD_TOKEN" --header "Content-Type: application/octet-stream" --data "{}" "$url" || exit $?
