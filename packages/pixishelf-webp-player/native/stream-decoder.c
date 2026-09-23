/* The pinned upstream compositor is compiled in this translation unit so that
 * partial demux refreshes can preserve its two canvases. This intentionally
 * depends on libwebp 1.6.0 internals; upgrades require the differential suite.
 * Upstream source and BSD/PATENTS notices are included in the build artifacts. */
#include "src/demux/anim_decode.c"
#include <stdlib.h>

typedef struct {
  WebPAnimDecoder dec;
  uint8_t* input;
  size_t size, capacity, parsed_size;
  uint32_t max_pixels;
  int finished, duration, error;
  uint32_t completed_loops;
  WebPDemuxState state;
} StreamDecoder;

/* ABI results: 0 need input, 1 success/frame, 2 drained; negative is terminal:
 * -1 malformed, -2 resource budget, -3 unsupported metadata. */
StreamDecoder* ps_create(uint32_t capacity, uint32_t max_pixels) {
  StreamDecoder* s = (StreamDecoder*)calloc(1, sizeof(*s));
  if (!s) return NULL;
  s->input = (uint8_t*)malloc(capacity);
  if (!s->input) { free(s); return NULL; }
  s->capacity = capacity;
  s->max_pixels = max_pixels;
  WebPAnimDecoderOptions options;
  DefaultDecoderOptions(&options);
  if (!ApplyDecoderOptions(&options, &s->dec)) {
    free(s->input); free(s); return NULL;
  }
  s->dec.next_frame = 1;
  return s;
}

static int Refresh(StreamDecoder* s) {
  if (s->size < 12) return 0;
  WebPAnimDecoder* d = &s->dec;
  if (d->demux && s->parsed_size == s->size) return 1;
  s->parsed_size = s->size;
  WebPDemuxReleaseIterator(&d->prev_iter);
  memset(&d->prev_iter, 0, sizeof(d->prev_iter));
  WebPDemuxDelete(d->demux);
  WebPData data = {s->input, s->size};
  d->demux = WebPDemuxPartial(&data, &s->state);
  if (s->state == WEBP_DEMUX_PARSE_ERROR) return s->error = -1;
  if (!d->demux || s->state == WEBP_DEMUX_PARSING_HEADER) return 0;
  const uint32_t flags = WebPDemuxGetI(d->demux, WEBP_FF_FORMAT_FLAGS);
  if (!(flags & ANIMATION_FLAG)) return s->error = -1;
  if (flags & (ICCP_FLAG | EXIF_FLAG)) return s->error = -3;
  const uint32_t w = WebPDemuxGetI(d->demux, WEBP_FF_CANVAS_WIDTH);
  const uint32_t h = WebPDemuxGetI(d->demux, WEBP_FF_CANVAS_HEIGHT);
  if (!w || !h || (uint64_t)w * h > s->max_pixels) return s->error = -2;
  if (!d->curr_frame) {
    d->info.canvas_width = w;
    d->info.canvas_height = h;
    d->curr_frame = (uint8_t*)WebPSafeCalloc((uint64_t)w * 4, h);
    d->prev_frame_disposed = (uint8_t*)WebPSafeCalloc((uint64_t)w * 4, h);
    if (!d->curr_frame || !d->prev_frame_disposed) return s->error = -2;
  }
  d->info.frame_count = WebPDemuxGetI(d->demux, WEBP_FF_FRAME_COUNT);
  if (d->next_frame > 1 && !WebPDemuxGetFrame(d->demux, d->next_frame - 1, &d->prev_iter))
    return s->error = -1;
  return 1;
}

int ps_append(StreamDecoder* s, const uint8_t* bytes, uint32_t length) {
  if (!s || s->finished || s->error) return s ? (s->error ? s->error : -1) : -1;
  if (length > s->capacity - s->size) return s->error = -2;
  memcpy(s->input + s->size, bytes, length);
  s->size += length;
  if (s->size >= 12) {
    if (memcmp(s->input, "RIFF", 4) || memcmp(s->input + 8, "WEBP", 4)) return s->error = -1;
    const uint64_t total = (uint64_t)GetLE32(s->input + 4) + 8;
    if (total > s->capacity) return s->error = -2;
    if (total < 12 || s->size > total) return s->error = -1;
  }
  return 1;
}

int ps_next(StreamDecoder* s) {
  if (!s || s->error) return s ? s->error : -1;
  if (Refresh(s) < 0) return s->error;
  WebPAnimDecoder* d = &s->dec;
  if (!d->demux) return s->finished ? (s->error = -1) : 0;
  WebPIterator it;
  memset(&it, 0, sizeof(it));
  if (!WebPDemuxGetFrame(d->demux, d->next_frame, &it)) return s->finished ? 2 : 0;
  if (!it.complete) { WebPDemuxReleaseIterator(&it); return s->finished ? (s->error = -1) : 0; }
  s->duration = it.duration <= 10 ? 100 : it.duration;
  WebPDemuxReleaseIterator(&it);
  /* Upstream timestamps use int; our player accumulates durations in JS double. */
  d->prev_frame_timestamp = 0;
  uint8_t* pixels;
  int timestamp;
  if (!WebPAnimDecoderGetNext(d, &pixels, &timestamp)) return s->error = -1;
  return 1;
}

int ps_finish(StreamDecoder* s) {
  if (!s || s->error) return s ? s->error : -1;
  if (Refresh(s) < 0) return s->error;
  if (s->size < 12 || (uint64_t)GetLE32(s->input + 4) + 8 != s->size ||
      s->state != WEBP_DEMUX_DONE || s->dec.info.frame_count == 0) return s->error = -1;
  s->finished = 1;
  return 1;
}
uint8_t* ps_pixels(StreamDecoder* s) { return s->dec.curr_frame; }
/* Repeat only validated, fully decoded input. Reset upstream's compositor in
 * place, retaining compressed bytes and bounded canvases across manual loops. */
int ps_repeat(StreamDecoder* s) {
  if (!s || s->error) return s ? s->error : -1;
  if (!s->finished || s->dec.next_frame <= (int)s->dec.info.frame_count) return -1;
  const uint32_t loops = WebPDemuxGetI(s->dec.demux, WEBP_FF_LOOP_COUNT);
  if (loops && ++s->completed_loops >= loops) return 2;
  WebPAnimDecoderReset(&s->dec);
  return 1;
}
uint32_t ps_width(StreamDecoder* s) { return s->dec.info.canvas_width; }
uint32_t ps_height(StreamDecoder* s) { return s->dec.info.canvas_height; }
int ps_duration(StreamDecoder* s) { return s->duration; }
void ps_destroy(StreamDecoder* s) {
  if (!s) return;
  WebPDemuxReleaseIterator(&s->dec.prev_iter);
  WebPDemuxDelete(s->dec.demux);
  WebPFreeDecBuffer(&s->dec.config.output);
  WebPSafeFree(s->dec.curr_frame);
  WebPSafeFree(s->dec.prev_frame_disposed);
  free(s->input);
  free(s);
}
