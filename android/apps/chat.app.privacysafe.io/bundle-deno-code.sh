#!/bin/bash

#TARGET_FILE="app/background-instance.mjs"
#
#echo "
#Deno.env = {
#  get: function() {
#    return undefined;
#  }
#}
#" > "$TARGET_FILE"
#
#deno bundle --no-lock "src-background-instance/background-instance.ts" >> "$TARGET_FILE" || exit $?
#
# Arguments are passed through: `--dev` keeps console output in the bundle.
deno run -A build-deno.js "$@" || exit $?
