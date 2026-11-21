#!/bin/bash

error_exit() {
  echo "$1"
  if [ -z "$2" ]
  then
    exit -5
  else
    exit $2
  fi
}

platform="$1"

if [ -z "$platform" ]
then
  echo "Platform is not given."
  echo
  echo "Unit tests run headless, but app tests need a PrivacySafe platform binary,"
  echo "a GUI and network access, hence the argument:"
  echo "    pnpm run test:all <path-to-platform-binary>"
  echo
  echo "Use \`pnpm run test\` to run only the unit tests."
  exit -3
fi

app_dir="$(realpath $(dirname ${BASH_SOURCE[0]})/..)"
( cd $app_dir || exit $?

for js_file in contactDenoServices.js
do
  if [ ! -f "app/$js_file" ]
  then
    error_exit "🔎  Missing pre-compiled component(s) in app/. Run \`pnpm run build:deno\` (or \`pnpm run tests:build-all\`) before this one"
  fi
done

echo
echo "=== Unit tests ==="
pnpm run test:unit || exit $?

echo
echo "=== Building the test app ==="
pnpm run tests:build || exit $?

echo
echo "=== App tests on $platform ==="
pnpm run tests:run-on "$platform" || exit $?

) || exit $?

echo
echo "✅  All tests passed"
