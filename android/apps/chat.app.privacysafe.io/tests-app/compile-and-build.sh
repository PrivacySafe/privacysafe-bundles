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

patch_app_manifest() {
  echo
  echo -n "Creating a patched app manifest ... "
  local manifest_patch="$2"
  local original_manifest="$1"
  local patched_manifest="$3"
  node -e "
    const patch = JSON.parse(fs.readFileSync('${manifest_patch}', 'utf8'));
    const m = JSON.parse(fs.readFileSync('${original_manifest}', 'utf8'));
    function placeTo(p, m) {
      if (!Array.isArray(p) || (p.length === 0)
      || p.find(f => (typeof f !== 'string'))) {
        throw new Error('Bad place value in patch: '+p.join(', '));
      }
      const field = p[p.length-1];
      const obj = p.slice(0,-1).reduce((o,f) => o[f], m);
      if (obj === undefined) {
        throw new Error('Parent object for place '+p.join(', ')+' is not found');
      }
      return { field, obj };
    }
    for (const { place, action, value } of patch) {
      const { obj, field } = placeTo(place, m);
      if (action === 'remove') {
        delete obj[field];
      } else if (action === 'set') {
        obj[field] = value;
      } else {
        throw new Error('Action '+action+' is not recognized for place '+place.join(', '));
      }
    }
    fs.writeFileSync('${patched_manifest}', JSON.stringify(m, undefined, 2));
  " || return $?
  echo "done."
}

privacysafe_url="https://3nsoft.com/downloads/PrivacySafe"

get_latest_app_version() {
	local app="$1"
  local channel="$2"
  local url="$privacysafe_url/3nweb-apps/$1/${channel}.latest"
	local app_ver=$(
    curl --silent --show-error --fail --location "$url" | tr -d '"'
  ) || return $?
  echo $app_ver
}

download_app_into() {
	local app="$1"
	local ver=$2
	local tempfile="$(mktemp -u)"
	local app_dir="$3"
	local zip_url="$privacysafe_url/3nweb-apps/$app/$ver/$app-$ver.zip"
	echo "📥  Downloading $app app from $zip_url"
	curl --silent --show-error --fail --location "$zip_url" --output "$tempfile" || return $?
  mkdir -p $app_dir || return $?
	unzip -q "$tempfile" -d "$app_dir" || return $?
	rm "$tempfile"
}

read_version_from_manifest_in() {
  local app_file="$1/manifest.json"
  node -e "
    const m = JSON.parse(fs.readFileSync('${app_file}', 'utf8'));
    if (m.version) {
      console.log(m.version);
    } else {
      throw new Error('No app version manifest file ${app_file}');
    }
  " || return $?
}

download_app_if_not_present() {
  local app="$1"
  local app_dir="test-ext-apps/$app"
  local channel="nightly"
  if [ -d "$app_dir" ]
  then
    local app_ver=$(read_version_from_manifest_in "$app_dir") || return $?
    echo "✔️ $app app version ${app_ver} is present"
  else
    local app_ver=$(get_latest_app_version $app $channel) || return $?
    download_app_into $app $app_ver $app_dir || return $?
  fi
}

tester_dir="$(realpath $(dirname ${BASH_SOURCE[0]}))"
( cd $tester_dir || exit $?

echo "Implicit check with no-emit vue's typescript compile"
vue-tsc --noEmit || exit $?
echo "Build with vite, reusing main vite config"
vite build || exit $?

cp -LHr public/* build/app/ || cp -r public/* build/app/ || exit $?

# The app's own public/ is not this directory's: the patched manifest exposes
# ice-servers.json as an FS resource initialized from the app folder, so the test
# build needs that file too - otherwise every call start logs a failed read and
# falls back to the copy inside the Deno bundle.
cp ../public/ice-servers.json build/app/ || exit $?

patch_app_manifest ../manifest.json manifest-patch.json build/manifest.json || error_exit "🚩 fail to patch manifest"

for js_file in background-instance.mjs
do
  if [ -f "../app/$js_file" ]
  then
    cp ../app/$js_file build/app/ || exit $?
  else
    error_exit "🔎  Missing pre-compiled component(s). Run build task before this one"
  fi
done

echo
echo "Checking apps needed for testing:"
for app in "contacts.app.privacysafe.io"
do
  download_app_if_not_present $app || error_exit "🔎  Missing app $app is needed for testing"
done

) || error_exit "❌  failed to compile and build test app in $tester_dir"