#!/bin/bash

echo "
Deno.env = {
  get: function() {
    return undefined;
  }
}
" > "app/storageDenoServices.js"

esbuild "src_deno/index.ts" --bundle --platform=node --format=esm >> "app/storageDenoServices.js" || exit $?
