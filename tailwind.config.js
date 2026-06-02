/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        bg: 'var(--bg)',
        'bg-tabs': 'var(--bg-tabs)',
        'bg-menu': 'var(--bg-menu)',
        'bg-rail': 'var(--bg-rail)',
        'bg-panel': 'var(--bg-panel)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-hover': 'var(--bg-hover)',
        'bg-active': 'var(--bg-active)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        'border-accent': 'var(--border-accent)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-dim': 'var(--text-dim)',
        'text-faint': 'var(--text-faint)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          glow: 'var(--accent-glow)',
          'glow-strong': 'var(--accent-glow-strong)',
          line: 'var(--accent-line)'
        },
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        milestone: 'var(--milestone)',
        'module-orcamento': 'var(--module-orcamento)',
        'module-planejamento': 'var(--module-planejamento)',
        'module-acompanhamento': 'var(--module-acompanhamento)',
        'module-medicoes': 'var(--module-medicoes)',
        'module-suprimentos': 'var(--module-suprimentos)',
        'module-equipe': 'var(--module-equipe)',
        'module-documentos': 'var(--module-documentos)'
      },
      fontSize: {
        '2xs': '10px',
        xs: '10.5px',
        sm: '11.5px',
        base: '12px',
        md: '13px',
        lg: '14px',
        xl: '16px',
        '2xl': '18px',
        '3xl': '20px'
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px'
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        },
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: []
}
