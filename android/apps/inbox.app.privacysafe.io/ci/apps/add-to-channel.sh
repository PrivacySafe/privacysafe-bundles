#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/upload-utils.sh"

app_domain="$1"
version="$2"
channel="$3"

if [ -z "$channel" ]
then
	echo "missing channel"
	exit -1
fi

ensure_upload_env_vars || exit $?

echo "Adding $app_domain version $version to channel $channel"

url="https://$SERVER/app/$app_domain/$channel/add?version=$version"

curl --silent --show-error --fail --cacert "$SERVER_CERT" -X POST --header "X-Access-Token: $UPLOAD_TOKEN" --header "Content-Type: application/octet-stream" --data "{}" "$url" || exit $?
