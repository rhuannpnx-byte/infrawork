/**
 * Tema dos gráficos (Recharts) expresso em variáveis CSS: SVG aceita `var()`
 * em atributos de apresentação (stroke/fill/stop-color), então os gráficos
 * acompanham os tokens de `styles/theme.css` (fonte única das cores).
 */
export const CHART_THEME = {
  gridStroke: 'var(--border)',
  axisStroke: 'var(--text-faint)',
  axisLabel: 'var(--text-muted)',
  tooltipBg: 'var(--bg-elevated)',
  tooltipBorder: 'var(--border-strong)',
  tooltipText: 'var(--text)',
  series: [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
    'var(--chart-6)'
  ]
}

export const tooltipStyle = {
  backgroundColor: CHART_THEME.tooltipBg,
  border: `1px solid ${CHART_THEME.tooltipBorder}`,
  borderRadius: '2px',
  fontSize: '11px',
  fontFamily: '"Archivo Variable", Archivo, system-ui, sans-serif',
  color: CHART_THEME.tooltipText,
  padding: '6px 8px'
}

export const axisStyle = {
  fontSize: 10,
  fontFamily: '"Archivo Variable", Archivo, system-ui, sans-serif',
  fill: CHART_THEME.axisLabel
}
