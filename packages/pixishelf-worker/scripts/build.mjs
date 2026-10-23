import { build } from 'esbuild'

await build({
  entryPoints: {
    main: 'src/main.ts',
    'artwork-dedup-reader-recovery': 'src/artwork-dedup-reader-recovery.ts',
    'artwork-dedup-reader': '../pixishelf-job-executors/src/artwork-dedup/reader-child.ts',
    healthcheck: 'src/healthcheck.ts',
    'pixiv-root-identity': 'src/pixiv-root-identity.ts',
    'media-content-recovery': 'src/media-content-recovery.ts',
    'capability-audit': 'src/capability-audit.ts'
  },
  absWorkingDir: new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  entryNames: '[name]',
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  external: ['@prisma/client', '.prisma/client', 'sharp'],
  logLevel: 'info'
})
