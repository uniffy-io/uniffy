import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

export function backgroundAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@mediapipe/tasks-vision', {
    paths: [dirname(require.resolve('@livekit/track-processors'))],
  })
  const names = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
  const prefix = '/background-blur/vision-0.10.14/'
  return {
    name: 'background-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.slice(prefix.length)
        if (!req.url?.startsWith(prefix) || !name || !names.includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(readFileSync(join(dirname(entry), 'wasm', name)))
      })
    },
    generateBundle() {
      for (const name of names) {
        this.emitFile({ type: 'asset', fileName: `${prefix.slice(1)}${name}`, source: readFileSync(join(dirname(entry), 'wasm', name)) })
      }
    },
  }
}
