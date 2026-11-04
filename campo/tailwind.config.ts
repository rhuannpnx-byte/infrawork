import type { Config } from 'tailwindcss'

// Paleta InfraWork — replicada do app desktop pra unificar identidade:
// - Stack de bg em escala curta (bg-base → bg-panel → bg-elevated)
// - Accent azul #4d8eff com glow translúcido em estado ativo/focus
// - Status semânticos alinhados com Tailwind defaults (success/warn/danger)
// - Raios pequenos (3-8px) pra estética técnica/CAD-like
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Camadas de background
        'bg-base': '#08090b',
        'bg-panel': '#0e1014',
        'bg-elevated': '#161922',
        // Aliases mantidos pra não quebrar classes existentes (surface-1/2)
        'surface-1': '#0e1014',
        'surface-2': '#161922',

        // Texto
        'on-surface': '#e6e8eb',
        'on-surface-dim': '#9aa1ab',
        'on-surface-muted': '#5b626c',

        // Bordas
        border: '#1b1e26',
        'border-strong': '#2a2f3a',

        // Accent (azul InfraWork)
        accent: {
          DEFAULT: '#4d8eff',
          dark: '#1d4fb0',
          fg: '#ffffff',
          line: '#4d8eff80', // 50% alpha — borda fina translúcida
          glow: '#4d8eff1f', // 12% alpha — bg sutil em hover/focus
        },

        // Info (ciano pra hyperlinks / badges informativos)
        info: {
          DEFAULT: '#56c7ff',
          dark: '#1b7ba8',
          fg: '#002c3f',
        },

        // Status semântico (alinhado com paleta desktop)
        ok: '#4ade80',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        // IBM Plex Sans pra UI; Plex Mono pra números (tabular-nums).
        // `display` usa o mesmo Plex Sans em peso 700 (sem Archivo).
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // Raios pequenos InfraWork (antes 12/16/20)
        sm: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        '2xl': '12px',
      },
      minHeight: {
        touch: '44px', // alvo de toque iOS glove-friendly
      },
      // env(safe-area-inset-*) resolvido pelo browser quando viewport-fit=cover.
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      transitionDuration: {
        // Default InfraWork — 120-160ms ease-out
        '150': '150ms',
      },
    },
  },
  plugins: [
    // Plugin custom para utilities pt-safe / pb-safe / px-safe.
    function ({ addUtilities }: { addUtilities: (u: Record<string, unknown>) => void }) {
      addUtilities({
        '.pt-safe': { paddingTop: 'env(safe-area-inset-top)' },
        '.pb-safe': { paddingBottom: 'env(safe-area-inset-bottom)' },
        '.pl-safe': { paddingLeft: 'env(safe-area-inset-left)' },
        '.pr-safe': { paddingRight: 'env(safe-area-inset-right)' },
        '.px-safe': {
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        },
        '.py-safe': {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
        '.pt-safe-plus-2': { paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' },
        '.pt-safe-plus-3': { paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' },
        '.pb-safe-plus-3': { paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' },
        '.pb-safe-plus-4': { paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' },
        '.mt-safe': { marginTop: 'env(safe-area-inset-top)' },
        // Tabular numbers — usar em qualquer span com valor numérico
        '.tabular': { fontVariantNumeric: 'tabular-nums' },
      })
    },
  ],
} satisfies Config
