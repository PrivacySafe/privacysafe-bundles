#!/bin/bash

if which deno
then

	# Arguments are passed through: `--dev` keeps console output in the bundle.
	deno run -A build-deno.js "$@" || exit $?

else

	echo "
	Deno.env = {
		get: function() {
			return undefined;
		}
	}
	" > "app/background-instance.mjs"

	esbuild "src-deno/index.ts" --bundle --platform=node --format=esm >> "app/background-instance.mjs" || exit $?

fi