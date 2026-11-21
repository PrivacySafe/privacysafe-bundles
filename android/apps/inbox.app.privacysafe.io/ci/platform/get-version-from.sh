#!/bin/bash

this_dir="$(dirname "${BASH_SOURCE[0]}")"
source "$this_dir/../utils/manifest-utils.sh"

get_from_json_file "$1" version