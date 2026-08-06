/// <reference types="vitest/config" />
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * Inject a Content-Security-Policy meta tag scoped to the build mode.
 * In prod the API shares the origin (connect-src 'self'); in dev,
 * if VITE_API_URL points elsewhere, that origin + its ws counterpart
 * are appended. 'unsafe-inline' on script/style is required by Vite
 * HMR + Tailwind / Milkdown style insertion.
 */
function cspMetaPlugin(connectExtras: string[]) {
  const connectSrc = ["'self'", ...connectExtras].join(' ')
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`,
    `style-src 'self' 'unsafe-inline'`,
    `worker-src 'self' blob:`,
    `font-src 'self' data:`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `connect-src ${connectSrc}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ')
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  return {
    name: 'csp-meta',
    transformIndexHtml(html: string) {
      return html.replace('<!--CSP-->', tag)
    },
  }
}

function deriveDevConnectExtras(apiUrl: string | undefined): string[] {
  if (!apiUrl || apiUrl.startsWith('/')) return []
  try {
    const u = new URL(apiUrl)
    const httpOrigin = `${u.protocol}//${u.host}`
    const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsOrigin = `${wsScheme}//${u.host}`
    return [httpOrigin, wsOrigin]
  } catch {
    return []
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const connectExtras = command === 'serve' ? deriveDevConnectExtras(env.VITE_API_URL) : []

  return {
  plugins: [
    react(),
    tailwindcss(),
    cspMetaPlugin(connectExtras),
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
    allowedHosts: ["localhost", "host.docker.internal"],
    proxy: {
      '/api/realtime': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
      // Same-origin LiveKit signaling (default LIVEKIT_WS_URL=/livekit),
      // mirroring the Caddy edge's handle_path: strip the prefix so the
      // SFU sees /rtc at its root. Keeps CSP connect-src 'self' intact.
      '/livekit': {
        target: process.env.LIVEKIT_PROXY_TARGET || 'http://localhost:7880',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    fs: {
      // Reach the pnpm workspace root so hoisted node_modules/.pnpm
      // assets (fontsource fonts etc.) resolve under Vite's fs guard.
      allow: [searchForWorkspaceRoot(__dirname)],
    },
    watch: {
      followSymlinks: true,
    },
  },
  optimizeDeps: {
    // Vite's initial scan only crawls the eager module graph, so deps reachable
    // solely through a lazy route or a web worker get discovered mid-session.
    // Re-optimizing rewrites the chunk hashes under node_modules/.vite/deps,
    // which strands any lazy import already in flight ("Failed to fetch
    // dynamically imported module"). Pre-bundle the late-discovered ones.
    include: [
      // Only pulled in by the notes editor route.
      '@milkdown/kit/prose/model',
      '@milkdown/kit/prose/view',
      '@milkdown/kit/prose/inputrules',
      // Imported from FileWorker.worker.ts; worker graphs are never scanned.
      'jszip',
    ],
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
  }
})
