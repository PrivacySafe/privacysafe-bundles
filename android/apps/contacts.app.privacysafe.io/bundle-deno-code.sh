#!/bin/bash

echo "
Deno.env = {
  get: function() {
    return undefined;
  }
}
" > "app/contactDenoServices.js"

esbuild "src-deno/contacts-deno-srv.ts" --bundle --platform=node --format=esm >> "app/contactDenoServices.js" || exit $?
