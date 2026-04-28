/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { buildSync } from 'esbuild'

/**
 * Plugin to build the media stream service worker for both dev and prod.
 * Uses esbuild to bundle the worker as a self-contained IIFE.
 * Service Workers cannot use ES module imports, so we must bundle everything.
 */
function mediaStreamWorkerPlugin() {
  const workerEntry = path.resolve(__dirname, 'src/workers/mediaStreamWorker.ts');
  const devOutDir = path.resolve(__dirname, '.vite-worker');
  const devOutFile = path.resolve(devOutDir, 'media-stream-worker.js');

  function buildWorker(outFile: string, minify = false) {
    try {
      const outDir = path.dirname(outFile);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      buildSync({
        entryPoints: [workerEntry],
        outfile: outFile,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        sourcemap: true,
        minify,
        alias: {
          '@': path.resolve(__dirname, './src'),
          '@uniffy/proto': path.resolve(__dirname, '../gen/typescript'),
        },
      });
      console.log('[MediaStreamWorker] Built successfully');
    } catch (error) {
      console.error('[MediaStreamWorker] Build failed:', error);
    }
  }

  // Build for dev immediately
  buildWorker(devOutFile);

  return {
    name: 'media-stream-worker',
    configureServer(server: {
      middlewares: { use: (middleware: (req: { url?: string }, res: { setHeader: (name: string, value: string) => void; end: (content: string | Buffer) => void }, next: () => void) => void) => void };
      watcher: { add: (path: string) => void; on: (event: string, callback: (path: string) => void) => void }
    }) {
      // Serve the worker file via middleware in dev
      server.middlewares.use((req, res, next) => {
        if (req.url === '/media-stream-worker.js') {
          if (fs.existsSync(devOutFile)) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(fs.readFileSync(devOutFile));
          } else {
            buildWorker(devOutFile);
            if (fs.existsSync(devOutFile)) {
              res.setHeader('Content-Type', 'application/javascript');
              res.setHeader('Cache-Control', 'no-cache');
              res.end(fs.readFileSync(devOutFile));
            } else {
              next();
            }
          }
          return;
        }
        if (req.url === '/media-stream-worker.js.map') {
          const mapFile = devOutFile + '.map';
          if (fs.existsSync(mapFile)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(mapFile));
          } else {
            next();
          }
          return;
        }
        next();
      });

      // Watch for changes in dev mode
      server.watcher.add(workerEntry);
      server.watcher.on('change', (changedPath: string) => {
        if (changedPath === workerEntry) {
          console.log('[MediaStreamWorker] Source changed, rebuilding...');
          buildWorker(devOutFile);
        }
      });
    },
    writeBundle(options: { dir?: string }) {
      // Build worker to dist folder for production (minified, self-contained IIFE)
      const distDir = options.dir || path.resolve(__dirname, 'dist');
      const prodOutFile = path.resolve(distDir, 'media-stream-worker.js');
      console.log('[MediaStreamWorker] Building for production...');
      buildWorker(prodOutFile, true);
    },
    closeBundle() {
      // Clean up dev temp directory
      if (fs.existsSync(devOutDir)) {
        fs.rmSync(devOutDir, { recursive: true, force: true });
      }
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mediaStreamWorkerPlugin(),
  ],
  define: {
    // Silence Vue feature flag warnings from 
    // @milkdown/crepe (which uses Vue internally)
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@uniffy/proto': path.resolve(__dirname, '../gen/typescript'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ["dev.local.uniffy.io", "localhost", "host.docker.internal"],
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        path.resolve(__dirname, '.'),
        path.resolve(__dirname, '../gen/typescript'),
      ],
    },
    watch: {
      followSymlinks: true,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // pnpm nests packages under node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...
          // Use the last node_modules segment to get the actual package name.
          const parts = id.split('node_modules/');
          const tail = parts[parts.length - 1];
          const match = tail.match(/^(@[^/]+\/[^/]+|[^/]+)/);
          const pkg = match ? match[1] : '';

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router-dom' || pkg === 'scheduler') {
            return 'vendor-react';
          }
          if (pkg === '@reduxjs/toolkit' || pkg === 'react-redux' || pkg === 'redux-persist' || pkg === 'redux' || pkg === 'immer' || pkg === 'reselect') {
            return 'vendor-redux';
          }
          // lodash-es is shared by @milkdown/* (vendor-editor) and force-graph
          // (vendor-ui via react-force-graph-2d). Without an explicit chunk,
          // Rollup parks it inside vendor-editor and vendor-ui ends up calling
          // into a not-yet-initialized binding ("vS is not a function").
          // Hoist to its own chunk so both consumers init after it.
          if (pkg === 'lodash-es' || pkg === 'lodash') {
            return 'vendor-lodash';
          }
          // Milkdown + CodeMirror share transitive edges with vendor-ui
          // (phosphor icons, prosemirror-view pulls react-like utils),
          // so splitting them creates a circular chunk graph. Keep merged.
          if (
            pkg.startsWith('@milkdown/') ||
            pkg.startsWith('prosemirror-') ||
            pkg === 'codemirror' ||
            pkg.startsWith('@codemirror/') ||
            pkg.startsWith('@lezer/')
          ) {
            return 'vendor-editor';
          }
          if (pkg === '@connectrpc/connect' || pkg === '@connectrpc/connect-web' || pkg === '@bufbuild/protobuf') {
            return 'vendor-connect';
          }
          if (pkg === '@headlessui/react' || pkg === '@phosphor-icons/react' || pkg.startsWith('@radix-ui/') || pkg.startsWith('@dnd-kit/') || pkg === 'react-resizable-panels' || pkg === 'react-force-graph-2d') {
            return 'vendor-ui';
          }
          if (pkg === 'date-fns' || pkg === 'date-fns-tz') {
            return 'vendor-date';
          }
          if (pkg === 'video.js' || pkg === 'wavesurfer.js') {
            return 'vendor-media';
          }
          if (pkg === 'jszip' || pkg === 'zod' || pkg === 'idb' || pkg === 'clsx' || pkg === 'tailwind-merge') {
            return 'vendor-utils';
          }
          return undefined;
        },
      },
    },
    // vendor-editor (Milkdown + CodeMirror + ProseMirror + Lezer) cannot be
    // split without introducing a circular chunk graph, so it sits around 2.6MB.
    chunkSizeWarningLimit: 2700,
  },
})
