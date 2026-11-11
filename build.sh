#!/usr/bin/env bash
# Builds a signed release APK using only the Android SDK command-line build tools
# (aapt2, d8 or dx, zipalign, apksigner) and a JDK. No Gradle and no internet needed.
#
#   ./build.sh            -> release/GasStationManager-<version>.apk
#
# Tool lookup order: $ANDROID_HOME / $ANDROID_SDK_ROOT (newest build-tools and platform),
# then /usr/lib/android-sdk (Debian/Ubuntu packages), then whatever is on PATH.
set -euo pipefail
cd "$(dirname "$0")"

prop() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2-; }
VERSION_NAME=$(prop version.properties versionName)
VERSION_CODE=$(prop version.properties versionCode)
MIN_SDK=$(prop version.properties minSdk)
TARGET_SDK=$(prop version.properties targetSdk)
[ -f keystore/keystore.properties ] || { echo "Missing keystore/keystore.properties - see README, \"Signing key\"."; exit 1; }
KS_FILE=$(prop keystore/keystore.properties storeFile)
KS_PASS=$(prop keystore/keystore.properties storePassword)
KS_ALIAS=$(prop keystore/keystore.properties keyAlias)
KEY_PASS=$(prop keystore/keystore.properties keyPassword)

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/lib/android-sdk}}"
BT=""
if [ -d "$SDK/build-tools" ]; then
  BT=$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | grep -v debian | sort -V | tail -1 || true)
fi
tool() { if [ -n "$BT" ] && [ -x "$BT$1" ]; then echo "$BT$1"; else command -v "$1" || true; fi; }
AAPT2=$(tool aapt2); ZIPALIGN=$(tool zipalign); APKSIGNER=$(tool apksigner); D8=$(tool d8); DX=$(tool dx)
[ -z "$DX" ] && DX=$(command -v dalvik-exchange || true)
ANDROID_JAR=$(ls "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1 || true)
for t in AAPT2 ZIPALIGN APKSIGNER ANDROID_JAR; do
  [ -n "${!t}" ] || { echo "Missing $t. Install the Android SDK build-tools and a platform (see README)."; exit 1; }
done
[ -n "$D8$DX" ] || { echo "Missing d8/dx. Install the Android SDK build-tools (see README)."; exit 1; }
echo "SDK: $SDK"; echo "android.jar: $ANDROID_JAR"

OUT=build/manual
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex" release

# 1. Resources
# The source manifest has no package attribute (Gradle takes it from `namespace`); aapt2 needs one.
sed 's|<manifest xmlns:android="http://schemas.android.com/apk/res/android">|<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.gasstation.manager">|' \
  app/src/main/AndroidManifest.xml > "$OUT/AndroidManifest.xml"
"$AAPT2" compile --dir app/src/main/res -o "$OUT/res.zip"
"$AAPT2" link -o "$OUT/unaligned.apk" -I "$ANDROID_JAR" \
  --manifest "$OUT/AndroidManifest.xml" -A app/src/main/assets \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

# 2. Java -> dex
javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find app/src/main/java -name '*.java')
if [ -n "$D8" ]; then
  "$D8" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
else
  "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$OUT/dex/classes.dex" "$OUT/classes"
fi
(cd "$OUT/dex" && zip -q -j ../unaligned.apk classes.dex)

# 3. Align + sign
APK="release/GasStationManager-$VERSION_NAME.apk"
"$ZIPALIGN" -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"
"$APKSIGNER" sign --ks "$KS_FILE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version "$MIN_SDK" --out "$APK" "$OUT/aligned.apk"
rm -f "$APK.idsig"
"$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$APK"
echo "Built $APK ($(du -h "$APK" | cut -f1))"
