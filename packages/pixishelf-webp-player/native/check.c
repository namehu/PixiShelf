#include "stream-decoder.c"
#include <stdio.h>

/* Compare partial-input playback with upstream's full-file animation decoder.
 * Running this binary with ASan/UBSan exercises iterator ownership on every
 * byte boundary, including frame headers, alpha payloads and RIFF padding. */
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  FILE* file = fopen(argv[1], "rb");
  if (!file) return 2;
  fseek(file, 0, SEEK_END);
  const long length = ftell(file);
  rewind(file);
  uint8_t* bytes = (uint8_t*)malloc((size_t)length);
  if (!bytes || fread(bytes, 1, (size_t)length, file) != (size_t)length) return 2;
  fclose(file);
  WebPData data = {bytes, (size_t)length};
  WebPAnimDecoder* reference = WebPAnimDecoderNew(&data, NULL);
  if (!reference) return 3;
  WebPAnimInfo info;
  WebPAnimDecoderGetInfo(reference, &info);
  for (size_t split = 1; split <= 127; split = split == 1 ? 7 : split == 7 ? 127 : 128) {
    StreamDecoder* stream = ps_create((uint32_t)length, 8000000);
    if (!stream) return 4;
    if (ps_next(stream) != 0) return 12;
    if (ps_repeat(stream) != -1) return 13;
    WebPAnimDecoderReset(reference);
    int frames = 0;
    for (size_t offset = 0; offset < (size_t)length;) {
      size_t take = (size_t)length - offset;
      if (take > split) take = split;
      if (ps_append(stream, bytes + offset, (uint32_t)take) != 1) return 5;
      offset += take;
      int next;
      while ((next = ps_next(stream)) == 1) {
        uint8_t* pixels; int timestamp;
        if (!WebPAnimDecoderGetNext(reference, &pixels, &timestamp)) return 6;
        if (memcmp(pixels, ps_pixels(stream), (size_t)info.canvas_width * info.canvas_height * 4)) return 7;
        frames++;
      }
      if (next < 0) return 8;
    }
    if (ps_finish(stream) != 1 || ps_next(stream) != 2 || frames != (int)info.frame_count) return 9;
    for (int cycle = 0; cycle < 3; ++cycle) {
      if (ps_repeat(stream) != 1) return 14;
      WebPAnimDecoderReset(reference);
      for (uint32_t frame = 0; frame < info.frame_count; ++frame) {
        uint8_t* pixels; int timestamp;
        if (ps_next(stream) != 1 || !WebPAnimDecoderGetNext(reference, &pixels, &timestamp)) return 15;
        if (memcmp(pixels, ps_pixels(stream), (size_t)info.canvas_width * info.canvas_height * 4)) return 16;
      }
      if (ps_next(stream) != 2) return 17;
    }
    ps_destroy(stream);
  }
  StreamDecoder* truncated = ps_create((uint32_t)length, 8000000);
  if (ps_append(truncated, bytes, (uint32_t)length - 1) != 1 || ps_finish(truncated) != -1) return 10;
  ps_destroy(truncated);
  StreamDecoder* limited = ps_create(12, 8000000);
  if (ps_append(limited, bytes, 12) != -2) return 11;
  ps_destroy(limited);
  /* A finite ANIM loop count must end without an extra iteration. */
  for (size_t offset = 12; offset + 8 <= (size_t)length;) {
    uint32_t size = GetLE32(bytes + offset + 4);
    if (!memcmp(bytes + offset, "ANIM", 4) && size == 6) {
      bytes[offset + 12] = 2;
      bytes[offset + 13] = 0;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  StreamDecoder* finite = ps_create((uint32_t)length, 8000000);
  if (ps_append(finite, bytes, (uint32_t)length) != 1 || ps_finish(finite) != 1) return 18;
  for (int cycle = 0; cycle < 2; ++cycle) {
    for (uint32_t frame = 0; frame < info.frame_count; ++frame)
      if (ps_next(finite) != 1) return 19;
    if (ps_next(finite) != 2 || ps_repeat(finite) != (cycle ? 2 : 1)) return 20;
  }
  ps_destroy(finite);
  WebPAnimDecoderDelete(reference); free(bytes);
  puts("native differential/chunk/truncation/budget/loop checks passed");
  return 0;
}
