
echo
echo "Building debug apk, as it doesn't require signing key."
(cd android || exit $?
	./gradlew assembleDebug || exit $?
) || exit $?
