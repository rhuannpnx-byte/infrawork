export const CHART_THEME = {
  gridStroke: 'oklch(22% 0.011 255)',
  axisStroke: 'oklch(38% 0.006 255)',
  axisLabel: 'oklch(72% 0.010 255)',
  tooltipBg: 'oklch(18% 0.010 255)',
  tooltipBorder: 'oklch(28% 0.013 255)',
  tooltipText: 'oklch(92% 0.006 255)',
  series: [
    'oklch(67% 0.18 255)',
    'oklch(85% 0.12 215)',
    'oklch(78% 0.18 145)',
    'oklch(82% 0.16 80)',
    'oklch(74% 0.14 295)',
    'oklch(73% 0.16 350)'
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
