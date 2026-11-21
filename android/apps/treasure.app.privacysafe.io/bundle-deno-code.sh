#!/bin/bash

echo "
Deno.env = {
  get: function() {
    return undefined;
  }
}
" > "app/treasureDenoServices.js"

esbuild "src-deno/treasure-deno-srv.ts" --bundle --platform=node --format=esm >> "app/treasureDenoServices.js" || exit $?

# deno bundle --no-lock "src-deno/treasure-deno-srv.ts" >> "app/treasureDenoServices.js" || exit $?
