import { defineConfig, minimalPreset } from '@vite-pwa/assets-generator/config'

/**
 * Configuração do gerador de ícones do PWA.
 *
 * Rodar `npm run generate-pwa-assets` (uma única vez por mudança no favicon)
 * gera em `public/`:
 *  - pwa-64x64.png, pwa-192x192.png, pwa-512x512.png (Android/Chrome via manifest)
 *  - maskable-icon-512x512.png (ícone redondo Android adaptive)
 *  - apple-touch-icon-180x180.png (iOS — Safari usa esse pra Tela de Início)
 *  - favicon.ico (legado)
 *
 * `headLinkOptions.preset: '2023'` gera tags `<link>` segundo a recomendação atual
 * (sem múltiplos sizes apple-touch-icon, que iOS moderno não usa mais).
 */
export default defineConfig({
  preset: minimalPreset,
  // Source InfraWork: PNG 1024×1024 com o monograma IW azul (viga I-beam com glow).
  // Antes era o favicon.svg do "M amarelo" — substituído na rebrand.
  images: ['assets/icon.png'],
  headLinkOptions: { preset: '2023' },
})
