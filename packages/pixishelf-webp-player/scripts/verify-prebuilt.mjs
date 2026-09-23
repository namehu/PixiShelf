import { verifyPrebuilt } from './prebuilt.mjs'
const { toolchain } = await verifyPrebuilt()
console.log(`WebP prebuilt verified: libwebp ${toolchain.libwebp}, Emscripten ${toolchain.emscripten}`)
