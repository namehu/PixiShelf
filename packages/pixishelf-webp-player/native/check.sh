#!/bin/sh
set -eu
cd /work
: "${LIBWEBP_VERSION:?Use scripts/build-native.mjs}"
source_dir=.cache/libwebp-${LIBWEBP_VERSION}
cmake -S "$source_dir" -B .cache/native-check \
  -DCMAKE_BUILD_TYPE=Debug -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_C_FLAGS='-fsanitize=address,undefined -fno-omit-frame-pointer' \
  -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
cmake --build .cache/native-check -j 4
cc -g -fsanitize=address,undefined -fno-omit-frame-pointer native/check.c \
  -I"$source_dir" -I.cache/native-check .cache/native-check/libwebpdemux.a \
  .cache/native-check/libwebp.a .cache/native-check/libsharpyuv.a -lm -o .cache/native-check/check
.cache/native-check/check tests/fixtures/composite.webp
.cache/native-check/check tests/fixtures/short.webp
