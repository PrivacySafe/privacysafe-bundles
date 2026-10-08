#!/bin/bash

echo "
Deno.env = {
  get: function() {
    return undefined;
  }
}
" > "app/storageDenoServices.js"

deno bundle --no-lock "src_deno/index.ts" >> "app/storageDenoServices.js" || exit $?
