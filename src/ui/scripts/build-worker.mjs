import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, '..');

await build({
    entryPoints: [resolve(uiRoot, 'src/workers/mediaStreamWorker.ts')],
    outfile: resolve(uiRoot, 'dist/media-stream-worker.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    alias: {
        '@': resolve(uiRoot, 'src'),
        '@uniffy/proto': resolve(uiRoot, '../gen/typescript'),
    },
});
