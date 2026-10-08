import type { NativeModule } from './wasm-decoder'

// A minimal module returning v128.const; validate without compiling a decoder or fetching assets.
export function supportsSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 11
      ])
    )
  } catch {
    return false
  }
}
export async function loadNative(decoderUrl: string, maxHeapBytes: number) {
  const instantiate = async (url: string) => {
    const { default: factory } = await import(/* @vite-ignore */ url)
    return (await factory({
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: maxHeapBytes / 65536 }),
      locateFile: (file: string) => new URL(file, url).href
    })) as NativeModule
  }
  const url = new URL(decoderUrl)
  // Preserve custom decoder URLs. Only the shipped scalar entry has a SIMD sibling.
  if (url.pathname.endsWith('/decoder.mjs') && supportsSimd()) {
    url.pathname = url.pathname.replace(/decoder\.mjs$/, 'decoder-simd.mjs')
    try {
      return { module: await instantiate(url.href), variant: 'simd' as const }
    } catch {
      // A stale/missing SIMD asset must not prevent playback on the compatible build.
    }
  }
  return { module: await instantiate(decoderUrl), variant: 'scalar' as const }
}
