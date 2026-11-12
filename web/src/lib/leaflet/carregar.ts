let modulo: typeof import('leaflet') | null = null

/** Carrega o Leaflet (e o CSS dele) sob demanda, uma vez só. */
export async function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (modulo) return modulo
  const m = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  modulo = m
  return m
}
