#!/bin/bash

BUNDLER_PROJ="94"

brand="$1"
channel="$2"

echo "Triggering bundling of $brand for channel $channel"

curl --silent --show-error -X POST -F "token=${CI_JOB_TOKEN}" -F ref=main -F "variables[CHANNEL]=$channel" -F "variables[BRAND]=$brand" "https://gitlab.3nsoft.net/api/v4/projects/${BUNDLER_PROJ}/trigger/pipeline" || exit $?
