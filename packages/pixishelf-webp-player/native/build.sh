#!/bin/sh
set -eu
cd /work
mkdir -p .cache dist/native
: "${LIBWEBP_VERSION:?Use scripts/build-native.mjs}"
: "${LIBWEBP_SHA256:?Use scripts/build-native.mjs}"
archive=.cache/libwebp-${LIBWEBP_VERSION}.tar.gz
source_dir=.cache/libwebp-${LIBWEBP_VERSION}
if [ ! -f "$archive" ]; then
  curl -fL --retry 3 "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${LIBWEBP_VERSION}.tar.gz" -o "$archive"
fi
echo "$LIBWEBP_SHA256  $archive" | sha256sum -c -
if [ ! -d "$source_dir" ]; then tar -xzf "$archive" -C .cache; fi
emcmake cmake -S "$source_dir" -B .cache/wasm-build \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
cmake --build .cache/wasm-build -j 4
emcc native/stream-decoder.c -I"$source_dir" -I.cache/wasm-build \
  .cache/wasm-build/libwebpdemux.a .cache/wasm-build/libwebp.a .cache/wasm-build/libsharpyuv.a \
  -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node \
  -s ALLOW_MEMORY_GROWTH=1 -s IMPORTED_MEMORY=1 -s MAXIMUM_MEMORY=805306368 \
  -s INITIAL_MEMORY=16777216 -s FILESYSTEM=0 -s DYNAMIC_EXECUTION=0 -s ABORTING_MALLOC=0 \
  -s EXPORTED_FUNCTIONS='["_ps_create","_ps_append","_ps_next","_ps_finish","_ps_repeat","_ps_pixels","_ps_width","_ps_height","_ps_duration","_ps_destroy","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' -o dist/native/decoder.mjs
cp "$source_dir/COPYING" dist/native/libwebp-license.txt
cp "$source_dir/PATENTS" dist/native/libwebp-patents.txt
