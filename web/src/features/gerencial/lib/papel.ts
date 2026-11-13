import type { Role } from '@/types/auth'

/** Cor do selo de cada papel, a mesma em Usuários e nos acessos da obra. */
export const VARIANTE_PAPEL: Record<Role, 'accent' | 'success' | 'warn' | 'default'> = {
  god: 'accent',
  adm: 'warn',
  engenheiro: 'success',
  apoio: 'default',
  cliente: 'default',
  apontador: 'default'
}

export const variantePapel = (
  papel: string | null | undefined
): 'accent' | 'success' | 'warn' | 'default' => VARIANTE_PAPEL[papel as Role] ?? 'default'
