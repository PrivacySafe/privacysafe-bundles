
ensure_upload_env_vars() {
	if [ -z "$UPLOAD_TOKEN" ]
	then
		echo "Variable UPLOAD_TOKEN is not set. Is it present in the project? Is it present for this git branch?"
		return -3
	fi
	if [ -z "$SERVER_CERT" ]
	then
		echo "Variable SERVER_CERT is not set with path to certificate file."
		return -3
	fi
	if [ ! -f "$SERVER_CERT" ]
	then
		echo "File with webhook server's TLS certificate $SERVER_CERT is not found"
		return -3
	fi
}

upload_platform_file() {
	ensure_upload_env_vars || return $?
	local brand="$1"
	local version="$2"
	local content="$3"
	local file="$4"
	local os="$5"

	if [ ! -e "$file" ]
	then
		echo "$content file $file is not found"
		return 1
	fi
	echo "Uploading $file as
	content: $content
	version: $version"
	local url="https://$SERVER/platform/${brand}/add-file?version=$version&content=$content&file=$file&os=$os"
	curl --silent --show-error --fail --cacert "$SERVER_CERT" -X POST --header "X-Access-Token: $UPLOAD_TOKEN" --header "Content-Type: application/octet-stream" --data-binary "@$file" "$url" || return $?
	echo
}
