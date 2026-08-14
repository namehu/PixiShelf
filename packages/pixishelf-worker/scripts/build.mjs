import { build } from 'esbuild'

await build({
  entryPoints: {
    main: 'src/main.ts',
    healthcheck: 'src/healthcheck.ts'
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
  external: ['@prisma/client', '.prisma/client'],
  logLevel: 'info'
})
