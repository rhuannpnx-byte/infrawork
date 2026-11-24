import { calcularDmt, pedeEstaca, type LocalDmt, type ResultadoDmt } from '@/lib/dmt'
import { estacaParaMetros } from '@/lib/estaca'
import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto, LocalDto, OrigemDestinoDto } from '@/types/dtos'

export interface DmtDaViagem extends ResultadoDmt {
  /** estaca de carga em metros do eixo (null = vazia, inválida ou a ponta não é pista) */
  pc: number | null
  pd: number | null
}

export interface PontasDaViagem {
  origem: OrigemDestinoDto | null
  destino: OrigemDestinoDto | null
  /** eixo da ponta na pista, em que a viagem informa a estaca; null quando a ponta não pede estaca */
  eixoCarga: LocalDto | null
  eixoDescarga: LocalDto | null
  /** DMT com as estacas como foram digitadas (no padrão do eixo) */
  dmt: (estacaCarga: string, estacaDescarga: string) => DmtDaViagem
}

/**
 * As duas pontas de uma viagem (origem e destino), o eixo de cada uma quando é pista e a DMT pelas estacas. Usado
 * pelo formulário da viagem e pela folha de repetir, para as duas telas seguirem a mesma regra.
 */
export function pontasDaViagem(
  catalogo: CatalogoDto,
  origemId: string | null | undefined,
  destinoId: string | null | undefined,
): PontasDaViagem {
  const origem = catalogo.origens_destinos.find((l) => l.id === origemId) ?? null
  const destino = catalogo.origens_destinos.find((l) => l.id === destinoId) ?? null
  const tipoTrecho = (id: string): 'eixo' | 'area' | null =>
    catalogo.locais.find((t) => t.id === id)?.tipo ?? null
  const paraDmt = (l: OrigemDestinoDto | null): LocalDmt | null =>
    l && {
      id: l.id,
      nome: l.nome,
      tipo: l.tipo,
      trecho_id: l.trecho_id,
      estaca_acesso_m: l.estaca_acesso_m ?? null,
      distancia_acesso_km: l.distancia_acesso_km ?? 0,
    }
  const eixoDa = (l: OrigemDestinoDto | null): LocalDto | null =>
    l && pedeEstaca(paraDmt(l), tipoTrecho)
      ? (catalogo.locais.find((t) => t.id === l.trecho_id) ?? null)
      : null
  const eixoCarga = eixoDa(origem)
  const eixoDescarga = eixoDa(destino)
  const metros = (eixo: LocalDto | null, t: string): number | null =>
    eixo && t.trim() ? estacaParaMetros(eixo, t) : null
  return {
    origem,
    destino,
    eixoCarga,
    eixoDescarga,
    dmt: (estacaCarga, estacaDescarga) => {
      const pc = metros(eixoCarga, estacaCarga)
      const pd = metros(eixoDescarga, estacaDescarga)
      return {
        ...calcularDmt({
          origem: paraDmt(origem),
          destino: paraDmt(destino),
          estacaCarga: pc,
          estacaDescarga: pd,
          rotas: catalogo.rotas,
          tipoTrecho,
        }),
        pc,
        pd,
      }
    },
  }
}

/** A viagem repetida pede algo que muda de uma carga para a outra (estaca na pista, ou peso e ticket)? */
export function repetirPedeDados(catalogo: CatalogoDto, v: ViagemLocal): boolean {
  const { eixoCarga, eixoDescarga } = pontasDaViagem(catalogo, v.origemId, v.destinoId)
  const porPeso = catalogo.servicos.find((s) => s.id === v.servicoId)?.medicao_viagem === 'peso'
  return !!eixoCarga || !!eixoDescarga || porPeso
}
