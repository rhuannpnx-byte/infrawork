export const CHART_THEME = {
  gridStroke: '#1b1e26',
  axisStroke: '#3d4148',
  axisLabel: '#8b909a',
  tooltipBg: '#14171f',
  tooltipBorder: '#262a35',
  tooltipText: '#e8ebef',
  series: [
    '#4d8eff',
    '#67e8f9',
    '#4ade80',
    '#fbbf24',
    '#a78bfa',
    '#f472b6'
  ]
}

export const tooltipStyle = {
  backgroundColor: CHART_THEME.tooltipBg,
  border: `1px solid ${CHART_THEME.tooltipBorder}`,
  borderRadius: '4px',
  fontSize: '11px',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  color: CHART_THEME.tooltipText,
  padding: '6px 8px'
}

export const axisStyle = {
  fontSize: 10,
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fill: CHART_THEME.axisLabel
}
