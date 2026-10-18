#!/bin/bash
set -euo pipefail

ROOT_DIR="/app/applet"
cd "$ROOT_DIR"

echo "[BUILD-APK] Preparing web assets in android projects..."
mkdir -p "$ROOT_DIR/android/user/app/src/main/assets/www"
cp -r "$ROOT_DIR/apps/user-web/"* "$ROOT_DIR/android/user/app/src/main/assets/www/"

mkdir -p "$ROOT_DIR/android/admin/app/src/main/assets/www"
cp -r "$ROOT_DIR/apps/admin-web/"* "$ROOT_DIR/android/admin/app/src/main/assets/www/"

# Ensure debug.keystore exists
if [ ! -f "$ROOT_DIR/debug.keystore" ]; then
  echo "[BUILD-APK] Generating standard debug.keystore..."
  keytool -genkeypair -v \
    -keystore "$ROOT_DIR/debug.keystore" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US"
  mkdir -p "$HOME/.android"
  cp "$ROOT_DIR/debug.keystore" "$HOME/.android/debug.keystore"
fi

WORK_DIR=$(mktemp -d /tmp/apk_build_XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[BUILD-APK] Extracting base APK..."
mkdir -p "$WORK_DIR/extracted"
unzip -q "$ROOT_DIR/apps/site/download/ASHUR-User-latest.apk" -d "$WORK_DIR/extracted"

echo "[BUILD-APK] Cleaning old signatures..."
rm -rf "$WORK_DIR/extracted/META-INF"/*.SF "$WORK_DIR/extracted/META-INF"/*.RSA "$WORK_DIR/extracted/META-INF"/*.MF "$WORK_DIR/extracted/META-INF"/*.DSA 2>/dev/null || true

echo "[BUILD-APK] Updating assets/www with latest files..."
rm -rf "$WORK_DIR/extracted/assets/www"
mkdir -p "$WORK_DIR/extracted/assets/www"
cp -r "$ROOT_DIR/android/user/app/src/main/assets/www/"* "$WORK_DIR/extracted/assets/www/"

echo "[BUILD-APK] Repacking unsigned archive..."
(cd "$WORK_DIR/extracted" && zip -q -r -0 "$WORK_DIR/unaligned.apk" .)

echo "[BUILD-APK] Zipalign (4-byte alignment)..."
zipalign -f -p 4 "$WORK_DIR/unaligned.apk" "$WORK_DIR/aligned.apk"

echo "[BUILD-APK] Signing app-debug.apk with debug key..."
mkdir -p "$ROOT_DIR/app/build/outputs/apk/debug"
mkdir -p "$ROOT_DIR/android/user/app/build/outputs/apk/release"
mkdir -p "$ROOT_DIR/apps/site/download"

apksigner sign \
  --ks "$ROOT_DIR/debug.keystore" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" \
  "$WORK_DIR/aligned.apk"

cp "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" "$ROOT_DIR/apps/site/download/ASHUR-User-latest.apk"
cp "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" "$ROOT_DIR/android/user/app/build/outputs/apk/release/ASHUR-User-2.0.2.apk"
cp "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk" "$ROOT_DIR/android/user/app/build/outputs/apk/release/app-release.apk"

echo "[BUILD-APK] Verification:"
apksigner verify --verbose "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk"

echo "[BUILD-APK] Finished successfully! APK path: $ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk"
ls -lh "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk"
