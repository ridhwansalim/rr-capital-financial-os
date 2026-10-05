import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: { globIgnores: ['android/**'] },
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
        type: 'module'
      },
      includeAssets: ['rr-favicon.svg', 'rr-logo.svg', 'favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'RR Capital',
        short_name: 'RR Capital',
        description: 'Advanced Wealth Management OS',
        theme_color: '#0A1128',
        background_color: '#0A1128',
        display: 'standalone',
        icons: [
          {
            src: 'rr-favicon.svg',
            sizes: '256x256',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'rr-favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ],
        share_target: {
          action: '/_share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'image',
                accept: ['image/*']
              }
            ]
          }
        }
      } as any
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
