import type { EquipeDto } from '@/types/dtos'

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
