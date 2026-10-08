#!/bin/bash


info() {
	jq -r $@ android/bundle-info.json
}

mkdir_clean() {
	local dir="$1"
	if [ -d "$dir" ]
	then
		rm -rf $dir || return $?
	fi
	mkdir -p "$dir" || return $?
}

build_app() {
	local app_dir="$1"
	local dst_dir="$2"
	echo
	echo "  🛠️  building $app_dir and palcing it into $dst_dir"
	(cd "$app_dir"
		pnpm install --frozen-lockfile || exit $?
		pnpm run build || exit $?
	) || return $?
	mkdir_clean $dst_dir || return $?
	mv $app_dir/app $dst_dir/ || return $?
	cp $app_dir/manifest.json $dst_dir/ || return $?
}

echo
echo "  1️⃣  system 3NWeb apps"
for app in $(info .apps | jq -r keys[])
do
	dst_dir="android/platform-ts/dist/bundled-apps/$app"
	build_app apps/$app $dst_dir || exit $?
	(cd $dst_dir || exit $?
		node "../../../../../tools/hash-content.cjs" manifest.json app > content.json || exit $?
	) || exit $?
done

echo
echo "  2️⃣  bundled 3NWeb apps"
for app in $(info '."app-packs"' | jq -r keys[])
do
	dst_dir="android/platform-ts/dist/bundled-app-packs/$app"
	build_app apps/$app $dst_dir || exit $?
	(cd $dst_dir || exit $?
		node "../../../../../tools/hash-content.cjs" manifest.json app > content.json || exit $?
	) || exit $?
done

echo
echo "  3️⃣ prep platform's TypeScript code parts"
(cd android/platform-ts
	npm ci || exit $?
	npm run compile all || exit $?
) || exit $?

#  4️⃣ 