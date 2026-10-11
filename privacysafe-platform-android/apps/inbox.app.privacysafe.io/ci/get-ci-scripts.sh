#!/bin/bash

zip_file="artifact-ci-scripts.zip"

ci_proj="75"

curl -s --location "https://gitlab.3nsoft.net/api/v4/projects/${ci_proj}/jobs/artifacts/master/download?job=scripts&job_token=$CI_JOB_TOKEN" --output $zip_file || exit $?

temp_dir="downloaded-ci-scripts"
mkdir $temp_dir

unzip -q $zip_file -d $temp_dir || exit $?

rm $zip_file

mv $temp_dir/* ci/ || exit $?

rm -rf $temp_dir
