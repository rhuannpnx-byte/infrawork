/**
 * DMT de uma viagem — a mesma regra do banco (fn_viagem_antes, migração 0048), para mostrar antes de
 * salvar. O banco recalcula e é quem vale. Cópia idêntica em web/src/features/acompanhamento/lib/dmt.ts (mesmos testes).
 *
 * DMT = acesso(origem) + |estaca de carga − estaca de descarga| + acesso(destino), pelo eixo do trecho. Local na pista
 * entra com a estaca da viagem (sem acesso); os demais, com a estaca e a distância do acesso. A distância fixa
 * cadastrada para o par (rota) prevalece. Sem nenhuma das duas, não há DMT.
 */

export type TipoLocalTransporte =
  'jazida' | 'caixa_emprestimo' | 'bota_fora' | 'usina' | 'central' | 'deposito' | 'pista' | 'outro'

export interface LocalDmt {
  id: string
  nome: string
  tipo: TipoLocalTransporte | string
  trecho_id: string | null
  estaca_acesso_m: number | null
  distancia_acesso_km: number | null
}

export interface RotaDmt {
  origem_id: string
  destino_id: string
  dmt_km: number
}

export interface ResultadoDmt {
  km: number | null
  via: 'rota' | 'geometria' | null
  /** por que não há DMT (para orientar o cadastro) */
  motivo: string | null
}

/** O local é uma ponta na pista que pede a estaca da própria viagem (pista num eixo). */
export function pedeEstaca(
  local: LocalDmt | null | undefined,
  tipoTrecho: (id: string) => 'eixo' | 'area' | null,
): boolean {
  return (
    !!local && local.tipo === 'pista' && !!local.trecho_id && tipoTrecho(local.trecho_id) === 'eixo'
  )
}

const arred = (v: number): number => Math.round(v * 1000) / 1000

export function calcularDmt(a: {
  origem: LocalDmt | null | undefined
  destino: LocalDmt | null | undefined
  estacaCarga: number | null
  estacaDescarga: number | null
  rotas: RotaDmt[]
  tipoTrecho: (id: string) => 'eixo' | 'area' | null
}): ResultadoDmt {
  const { origem: o, destino: d } = a
  if (!o || !d) return { km: null, via: null, motivo: 'Escolha a origem e o destino.' }
  const rota = a.rotas.find((r) => r.origem_id === o.id && r.destino_id === d.id)
  if (rota) return { km: arred(Number(rota.dmt_km)), via: 'rota', motivo: null }
  const ponto = (l: LocalDmt, estaca: number | null): number | null => {
    if (!l.trecho_id || a.tipoTrecho(l.trecho_id) !== 'eixo') return null
    return l.tipo === 'pista' ? estaca : l.estaca_acesso_m
  }
  const pc = ponto(o, a.estacaCarga)
  const pd = ponto(d, a.estacaDescarga)
  if (o.trecho_id && o.trecho_id === d.trecho_id && pc != null && pd != null) {
    const acesso = (l: LocalDmt): number =>
      l.tipo === 'pista' ? 0 : Number(l.distancia_acesso_km ?? 0)
    return {
      km: arred(acesso(o) + Math.abs(pc - pd) / 1000 + acesso(d)),
      via: 'geometria',
      motivo: null,
    }
  }
  if (pedeEstaca(o, a.tipoTrecho) && a.estacaCarga == null)
    return { km: null, via: null, motivo: 'Informe a estaca de carga.' }
  if (pedeEstaca(d, a.tipoTrecho) && a.estacaDescarga == null)
    return { km: null, via: null, motivo: 'Informe a estaca de descarga.' }
  return {
    km: null,
    via: null,
    motivo: `Sem DMT de "${o.nome}" para "${d.nome}": cadastre a estaca de acesso dos locais (no mesmo trecho) ou a distância fixa do par.`,
  }
}
