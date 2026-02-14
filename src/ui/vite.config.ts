/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'
import fs from 'fs'

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
            const minifyFlag = minify ? '--minify' : '';
            execSync(
                `npx esbuild "${workerEntry}" --bundle --outfile="${outFile}" --format=iife --platform=browser --target=es2020 --sourcemap ${minifyFlag} --alias:@=${path.resolve(__dirname, './src')}`,
                { stdio: 'inherit', cwd: __dirname }
            );
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
    // SSL disabled - service workers require trusted certs
    // Use localhost (secure context by default) or get a real cert
    // basicSsl(),
    mediaStreamWorkerPlugin(),
  ],
  define: {
    // Silence Vue feature flag warnings from @milkdown/crepe (which uses Vue internally)
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ["dev.local.uniffy.io", "localhost"],
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
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
        manualChunks: {
          // Core React ecosystem
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Redux and state management
          'vendor-redux': ['@reduxjs/toolkit', 'react-redux', 'redux-persist'],
          // Editor - combined Milkdown + CodeMirror to avoid circular deps
          'vendor-editor': [
            '@milkdown/kit',
            '@milkdown/crepe',
            'codemirror',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/state',
            '@codemirror/view',
          ],
          // ConnectRPC and protobuf
          'vendor-connect': [
            '@connectrpc/connect',
            '@connectrpc/connect-web',
            '@bufbuild/protobuf',
          ],
          // UI utilities
          'vendor-ui': [
            '@headlessui/react',
            '@phosphor-icons/react',
          ],
        },
      },
    },
    // Increase limit for known large chunks (editor libraries are expected to be large)
    chunkSizeWarningLimit: 1500,
  },
})
