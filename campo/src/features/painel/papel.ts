/**
 * Quem vê a "Visão estratégica" no app: engenheiro, adm e god. Apontador e apoio ficam só com o lançamento.
 * O servidor confere de novo em `campo_painel` (o papel guardado no aparelho pode estar desatualizado);
 * isto aqui só esconde a área de quem não pode.
 */
export const PAPEIS_PAINEL = ['god', 'adm', 'engenheiro'] as const

export function podeVerPainel(role: string | null | undefined): boolean {
  return !!role && (PAPEIS_PAINEL as readonly string[]).includes(role)
}
