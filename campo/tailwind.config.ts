import type { Config } from 'tailwindcss'

// Identidade "Prancheta técnica" (web/DESIGN.md). As cores vêm das variáveis de src/styles/theme.css; os nomes de
// classe do app (bg-base, on-surface, ok, bad…) continuam os mesmos.
// Cor por variável que aceita transparência: `bg-bad/10` vira color-mix; sem `/NN` sai a variável pura.
const cor = (nome: string) =>
  (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || String(opacityValue).startsWith('var(')
      ? `var(--${nome})`
      : `color-mix(in oklab, var(--${nome}) calc(${opacityValue} * 100%), transparent)`) as unknown as string

const ARCHIVO = ['"Archivo Variable"', 'Archivo', 'system-ui', '-apple-system', 'sans-serif']

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': cor('bg'),
        'bg-panel': cor('bg-panel'),
        'bg-elevated': cor('bg-elevated'),
        'surface-1': cor('bg-panel'),
        'surface-2': cor('bg-elevated'),

        'on-surface': cor('text'),
        'on-surface-dim': cor('text-muted'),
        'on-surface-muted': cor('text-dim'),
        // só decoração (não atinge 4,5:1)
        'on-surface-faint': cor('text-faint'),

        border: cor('border'),
        'border-strong': cor('border-strong'),

        accent: {
          DEFAULT: cor('accent'),
          dark: cor('accent-hover'),
          fg: cor('on-accent'),
          line: cor('accent-line'),
          glow: cor('accent-glow'),
        },

        info: cor('info'),
        ok: cor('success'),
        warn: cor('warn'),
        bad: cor('danger'),
        // texto sobre ok/warn/bad/info em fundo cheio
        'on-status': cor('on-status'),
        veu: cor('veu'),
      },
      fontFamily: {
        // uma família só; `font-mono` é a mesma com algarismos tabulares (ver index.css)
        sans: ARCHIVO,
        display: ARCHIVO,
        mono: ARCHIVO,
      },
      // Sob sol, texto de leitura não fica abaixo de 14 px: `xs` é o piso de leitura; `2xs` é só para rótulo.
      fontSize: {
        '2xs': ['12px', { lineHeight: '16px' }],
        xs: ['14px', { lineHeight: '20px' }],
        sm: ['15px', { lineHeight: '22px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px' }],
      },
      borderRadius: {
        sm: '1px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        // só o topo das folhas que sobem de baixo
        '2xl': '8px',
      },
      boxShadow: {
        flutuante: 'var(--sombra-flutuante)',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
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
        // respiro lateral de 16 px que cresce com a área segura (barras de ação de baixo)
        '.px-safe-4': {
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        },
      })
    },
  ],
} satisfies Config
