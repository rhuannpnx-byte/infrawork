// Cor por variável CSS que aceita transparência: `bg-danger/10` vira color-mix; sem `/NN` sai a variável pura.
const cor =
  (nome) =>
  ({ opacityValue }) =>
    opacityValue === undefined || String(opacityValue).startsWith('var(')
      ? `var(--${nome})`
      : `color-mix(in oklab, var(--${nome}) calc(${opacityValue} * 100%), transparent)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Archivo Variable"', 'Archivo', 'system-ui', 'sans-serif'],
        // números e códigos: a mesma família, com algarismos tabulares (ver `.font-mono` em globals.css)
        mono: ['"Archivo Variable"', 'Archivo', 'system-ui', 'sans-serif']
      },
      colors: {
        bg: cor('bg'),
        'bg-tabs': cor('bg-tabs'),
        'bg-menu': cor('bg-menu'),
        'bg-rail': cor('bg-rail'),
        'bg-panel': cor('bg-panel'),
        'bg-elevated': cor('bg-elevated'),
        'bg-hover': cor('bg-hover'),
        'bg-active': cor('bg-active'),
        border: cor('border'),
        'border-strong': cor('border-strong'),
        'border-accent': cor('border-accent'),
        text: cor('text'),
        'text-muted': cor('text-muted'),
        'text-dim': cor('text-dim'),
        'text-faint': cor('text-faint'),
        accent: {
          DEFAULT: cor('accent'),
          hover: cor('accent-hover'),
          glow: cor('accent-glow'),
          'glow-strong': cor('accent-glow-strong'),
          line: cor('accent-line')
        },
        success: cor('success'),
        warn: cor('warn'),
        danger: cor('danger'),
        milestone: cor('milestone'),
        'module-orcamento': cor('module-orcamento'),
        'module-planejamento': cor('module-planejamento'),
        'module-acompanhamento': cor('module-acompanhamento'),
        'module-medicoes': cor('module-medicoes'),
        'module-suprimentos': cor('module-suprimentos'),
        'module-equipe': cor('module-equipe'),
        'module-documentos': cor('module-documentos')
      },
      fontSize: {
        '2xs': '11px',
        xs: '11.5px',
        sm: '12.5px',
        base: '13px',
        md: '14px',
        lg: '15px',
        xl: '17px',
        '2xl': '20px',
        '3xl': '24px'
      },
      borderRadius: {
        sm: '1px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px'
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms ease-out'
      }
    }
  },
  plugins: []
}
