import { mkdir } from 'node:fs/promises'
await mkdir(new URL('../public/', import.meta.url), { recursive: true })
await import('../../pixishelf-webp-player/scripts/build.mjs')
await import('../../pixishelf-webp-player/scripts/prepare-app.mjs')
