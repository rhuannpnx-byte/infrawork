import type { CatalogoDto, EquipeDto } from '@/types/dtos'

/**
 * Equipes que aparecem depois de escolher o encarregado: as dele. Sem encarregado, ou com um encarregado que ainda
 * não tem equipe vinculada, ficam as equipes sem encarregado.
 */
export function equipesDoEncarregado(
  equipes: EquipeDto[],
  encarregadoId: string | null,
): EquipeDto[] {
  const dele = encarregadoId ? equipes.filter((e) => e.encarregado_id === encarregadoId) : []
  return dele.length ? dele : equipes.filter((e) => !e.encarregado_id)
}

/** O encarregado tem equipes vinculadas a ele? */
export function temEquipesVinculadas(equipes: EquipeDto[], encarregadoId: string | null): boolean {
  return !!encarregadoId && equipes.some((e) => e.encarregado_id === encarregadoId)
}

/**
 * A obra pede o encarregado no lançamento? (Opção de Equipes e encarregados, no web.) Sem catálogo, ou com um catálogo
 * baixado antes de a opção existir, pede — é o comportamento de sempre.
 */
export function apontaEncarregado(catalogo: CatalogoDto | null | undefined): boolean {
  return catalogo?.obra?.aponta_encarregado !== false
}

/**
 * O encarregado da equipe. Na obra que não aponta o encarregado ele entra no lançamento junto com a equipe escolhida
 * (o banco faz o mesmo ao gravar), para a tela, a foto e o filtro continuarem sabendo quem responde.
 */
export function encarregadoDaEquipe(
  catalogo: CatalogoDto | null | undefined,
  equipeId: string | null,
): { id: string; nome: string } | null {
  const equipe = equipeId ? catalogo?.equipes.find((e) => e.id === equipeId) : null
  const enc = equipe?.encarregado_id
    ? catalogo?.encarregados.find((e) => e.id === equipe.encarregado_id)
    : null
  return enc ? { id: enc.id, nome: enc.nome } : null
}
