import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Regenera los iconos con: npx pwa-assets-generator
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.1, resizeOptions: { background: '#15202b' } },
    apple: { ...minimal2023Preset.apple, padding: 0.1, resizeOptions: { background: '#15202b' } },
  },
  images: ['public/favicon.svg'],
})
