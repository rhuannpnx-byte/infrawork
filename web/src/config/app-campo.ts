/** Endereço do app de campo (PWA). `VITE_CAMPO_URL` troca o endereço em outro ambiente (ex.: stack local). */
export const URL_APP_CAMPO: string =
  (import.meta.env.VITE_CAMPO_URL as string | undefined) || 'https://infrawork-campo.vercel.app'
