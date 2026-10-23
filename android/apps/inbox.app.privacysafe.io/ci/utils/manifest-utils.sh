
get_from_json() {
	local json_file="$1"
	local url="$2"
	if [ -n "$json_file" ]
	then
		local json_str_src="
			fs.readFileSync('$json_file', { encoding: 'utf8' })
		"
	elif [ -n "$url" ]
	then
		local json_str_src="
			child_process.execSync('curl -s -f "$url"', { encoding: 'utf-8' })
		"
	else
		echo "Neither file nor url given for json" 1>&2
		return 1
	fi
	shift 2
	local fields=""
	for field in $@
	do
		fields="$fields['$field']"
	done
	node -e "
		const json = JSON.parse($json_str_src);
		const val = json$fields;
		if ((typeof val === 'number')
		|| ((typeof val === 'string') && (val.length > 0))) {
			console.log(val);
		} else if (Array.isArray(val)) {
			console.log(val.join(' '));
		} else {
			throw new Error(
				\"Configuration json file has invalid field $fields\"
			);
		}
	" || return $?
}

get_from_json_file() {
	local json_file="$1"
	shift 1
	get_from_json "$json_file" "" $@ || return $?
}

get_from_remote_json() {
	local url="$1"
	shift 1
	get_from_json "" "$url" $@ || return $?
}

get_from_json_file() {
	local json_file="$1"
	shift 1
	get_from_json "$json_file" "" $@ || return $?
}

get_from_remote_json() {
	local url="$1"
	shift 1
	get_from_json "" "$url" $@ || return $?
}

version_from_manifest() {
	get_from_json_file "$1" "version" || return $?
}

app_domain_from_manifest() {
	get_from_json_file "$1" "appDomain" || return $?
}

app_pack_name() {
	local manifest="$1"
	local version=$(version_from_manifest $manifest)
	local app_domain=$(app_domain_from_manifest $manifest)
	echo "${app_domain}-${version}"
}

app_source_name() {
	echo "$(app_pack_name "$1")-src"
}
