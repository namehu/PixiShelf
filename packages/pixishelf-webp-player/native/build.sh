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
# libwebp 1.6.0 lists AVX2, SSE41, SSE2 before the non-Wasm targets,
# but its Emscripten cutoff still stops at index 2, skipping SSE2 entirely.
# Include SSE2 so the core decode/filter kernels use Wasm SIMD as well.
sed -i 's/if(EMSCRIPTEN AND ${I_SIMD} GREATER_EQUAL 2)/if(EMSCRIPTEN AND ${I_SIMD} GREATER_EQUAL 3)/' "$source_dir/cmake/cpu.cmake"
for variant in scalar simd; do
  simd=OFF
  flags=
  output=decoder
  if [ "$variant" = simd ]; then
    simd=ON
    flags=-msimd128
    output=decoder-simd
  fi
  emcmake cmake -S "$source_dir" -B .cache/wasm-build-$variant \
    -DCMAKE_C_FLAGS=-DEMSCRIPTEN -DWEBP_ENABLE_SIMD=$simd -DWEBP_USE_THREAD=OFF -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
    -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
    -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
  if [ "$variant" = simd ]; then
    grep -q '^#define WEBP_HAVE_SSE2 1' .cache/wasm-build-$variant/src/webp/config.h
    grep -q '^#define WEBP_HAVE_SSE41 1' .cache/wasm-build-$variant/src/webp/config.h
  fi
  cmake --build .cache/wasm-build-$variant -j 4
  emcc native/stream-decoder.c -I"$source_dir" -I.cache/wasm-build-$variant \
    .cache/wasm-build-$variant/libwebpdemux.a .cache/wasm-build-$variant/libwebp.a .cache/wasm-build-$variant/libsharpyuv.a \
    $flags -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node \
    -s ALLOW_MEMORY_GROWTH=1 -s IMPORTED_MEMORY=1 -s MAXIMUM_MEMORY=805306368 \
    -s INITIAL_MEMORY=16777216 -s FILESYSTEM=0 -s DYNAMIC_EXECUTION=0 -s ABORTING_MALLOC=0 \
    -s EXPORTED_FUNCTIONS='["_ps_create","_ps_append","_ps_next","_ps_finish","_ps_repeat","_ps_pixels","_ps_width","_ps_height","_ps_duration","_ps_destroy","_WebPGetInfo","_WebPDecodeRGBAInto","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' -o dist/native/$output.mjs
done
cp "$source_dir/COPYING" dist/native/libwebp-license.txt
cp "$source_dir/PATENTS" dist/native/libwebp-patents.txt
