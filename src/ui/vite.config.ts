import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ["dev.local.uniffy.io"]
  },
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
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