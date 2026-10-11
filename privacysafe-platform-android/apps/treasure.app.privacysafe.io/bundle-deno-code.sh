#!/bin/bash

echo "
Deno.env = {
  get: function() {
    return undefined;
  }
}
" > "app/treasureDenoServices.js"

deno bundle --no-lock "src-deno/treasure-deno-srv.ts" >> "app/treasureDenoServices.js" || exit $?
