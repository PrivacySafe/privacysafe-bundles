#!/bin/bash

tester_dir="$(dirname ${BASH_SOURCE[0]})"
data_dir="$tester_dir/test-data_$(date +%Y-%m-%d_%H-%M)"
signup_url="3nweb.net/signup/"
platform="$1"

# --- SOLUTION: Prevent embedded Deno from seeing package.json ---
export DENO_NO_PACKAGE_JSON=1
# -------------------------------------------------------------

# Inherited from a parent process this makes the platform binary start as plain
# node instead of as the app, so the run dies without ever reaching the specs.
unset ELECTRON_RUN_AS_NODE

if [ -z "$platform" ]
then
	echo "Platform is not given"
	exit -3
fi

echo
echo "Starting tests on $platform with"
echo "    data directory: $data_dir"
echo "    signup url: $signup_url"
echo

$platform -- --data-dir="$data_dir" --allow-multi-instances --devtools --signup-url=$signup_url --test-stand="$tester_dir/test-setup.json"

test_result=$?

if [ $test_result != 0 ]
then
	echo
	echo Listing logs after test that returned code $test_result
	for log in $(ls $data_dir/util/logs)
	do
		echo
		echo " --- $log ---"
		echo
		cat $data_dir/util/logs/$log
	done
fi

rm -rf "$data_dir"

exit $test_result