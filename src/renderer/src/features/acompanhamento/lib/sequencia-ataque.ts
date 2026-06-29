// Agregação da "Sequência de Ataque": para cada (dia × frente × encarregado ×
// serviço), traça uma seta da PRIMEIRA até a ÚLTIMA foto do dia. O balão mostra
// início/término (km/estaca do ponto do KMZ mais próximo), distância na unidade
// adotada, encarregado, frente, trecho e soma da qtd lançada no dia.

import type {
  FotoEnriquecida,
  ProducaoEnriquecida,
  SequenciaAtaque
} from '@/types/acompanhamento'
import { corDeServico } from '@/types/acompanhamento'
import type { ObraTrecho } from '@/types/gerencial'
import { metrosToMarcador } from '@/lib/format/posicao'
import {
  projetarPontoNoTrecho,
  marcadorFormatado,
  distanciaFormatada,
  unidadeLabel,
  trechoCtx,
  type ProjecaoTrecho
} from './projecao-trecho'

interface FotoGeo extends FotoEnriquecida {
  lat: number
  lng: number
}

function chaveGrupo(dia: string, frente: string | null, enc: string | null, serv: string | null): string {
  return `${dia}|${frente ?? ''}|${enc ?? ''}|${serv ?? ''}`
}

/** Normaliza um campo de display p/ casar foto × produção (trim + minúsculas). */
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Chave de produção SEM encarregado (dia × frente × serviço). */
function chaveFrenteServico(dia: string, frente: string | null, serv: string | null): string {
  return `${dia}|${norm(frente)}|${norm(serv)}`
}

interface BucketQtd {
  /** Total do (dia × frente × serviço), somando todos os encarregados. */
  total: number
  /** Quebra por encarregado normalizado. */
  porEnc: Map<string, number>
}

/**
 * Índice da qtd lançada por (dia × frente × serviço), com quebra por
 * encarregado. As fotos do SIGA frequentemente NÃO trazem o encarregado
 * (`encarregado_display_nome` nulo) mesmo quando a produção traz — então casar
 * pela tupla de 4 campos zera a qtd ("Qtd —"). Aqui resolvemos por nível:
 * quando a foto tem encarregado e ele casa, usa a qtd dele; senão usa o total
 * do dia/frente/serviço (semântica de um card não atribuído a encarregado).
 */
function indiceQtd(producoes: ProducaoEnriquecida[]): Map<string, BucketQtd> {
  const idx = new Map<string, BucketQtd>()
  for (const p of producoes) {
    if (!p.data) continue
    // Usa a qtd JÁ CONVERTIDA pelo fator (ex.: CBUQ 0,12), como no resto do acompanhamento.
    const qtd = Number(p.qtd_convertida ?? p.qtd) || 0
    const k = chaveFrenteServico(p.data, p.frente, p.servico_display_nome)
    let b = idx.get(k)
    if (!b) {
      b = { total: 0, porEnc: new Map() }
      idx.set(k, b)
    }
    b.total += qtd
    const en = norm(p.encarregado_display_nome)
    b.porEnc.set(en, (b.porEnc.get(en) ?? 0) + qtd)
  }
  return idx
}

/** Resolve a qtd de um grupo de fotos a partir do índice de produção. */
function qtdDoGrupo(
  idx: Map<string, BucketQtd>,
  dia: string,
  frente: string | null,
  enc: string | null,
  serv: string | null
): number {
  const b = idx.get(chaveFrenteServico(dia, frente, serv))
  if (!b) return 0
  const en = norm(enc)
  // Encarregado conhecido e casou → qtd dele; senão → total do dia/frente/serviço.
  if (en && b.porEnc.has(en)) return b.porEnc.get(en)!
  return b.total
}

/**
 * Constrói as setas da Sequência de Ataque. Grupos com menos de 2 fotos com GPS
 * (ou coordenadas idênticas) não viram seta. Considera TODOS os dias do conjunto
 * de fotos recebido (o caller aplica o filtro de período).
 */
export function agruparSequencias(
  fotos: FotoEnriquecida[],
  producoes: ProducaoEnriquecida[],
  trechos: ObraTrecho[]
): SequenciaAtaque[] {
  const qtdIdx = indiceQtd(producoes)

  // Agrupa fotos com GPS por (dia × frente × encarregado × serviço).
  const grupos = new Map<string, FotoGeo[]>()
  for (const f of fotos) {
    if (f.lat == null || f.lng == null || !f.captured_at) continue
    const dia = f.captured_date ?? f.captured_at.slice(0, 10)
    const k = chaveGrupo(dia, f.frente, f.encarregado_display_nome, f.servico_display_nome)
    const arr = grupos.get(k) ?? []
    arr.push({ ...f, lat: f.lat, lng: f.lng })
    grupos.set(k, arr)
  }

  const out: SequenciaAtaque[] = []
  for (const [k, lista] of grupos) {
    if (lista.length < 2) continue
    lista.sort((a, b) => (a.captured_at ?? '').localeCompare(b.captured_at ?? ''))
    const primeira = lista[0]
    const ultima = lista[lista.length - 1]
    // Coordenadas idênticas → sem deslocamento, pula.
    if (primeira.lat === ultima.lat && primeira.lng === ultima.lng) continue

    const projIni = projetarPontoNoTrecho(primeira.lng, primeira.lat, trechos)
    const projFim = projetarPontoNoTrecho(ultima.lng, ultima.lat, trechos)

    const dia = primeira.captured_date ?? primeira.captured_at!.slice(0, 10)
    const servico = primeira.servico_display_nome ?? primeira.siga_servico_nome ?? null
    const cor = corDeServico(primeira.siga_servico_id ?? servico)

    const trechoNome = projIni?.trecho.nome ?? projFim?.trecho.nome ?? null
    const uLabel = projIni ? unidadeLabel(projIni.trecho) : projFim ? unidadeLabel(projFim.trecho) : ''

    // Sentido do ataque: compara o marcador (km/estaca) de início e fim no mesmo trecho.
    let sentido: 'crescente' | 'decrescente' | null = null
    if (projIni && projFim && projIni.trecho.id === projFim.trecho.id) {
      const ctx = trechoCtx(projIni.trecho)
      const mi = metrosToMarcador(projIni.metrosInternos, ctx)
      const mf = metrosToMarcador(projFim.metrosInternos, ctx)
      sentido = mf > mi ? 'crescente' : mf < mi ? 'decrescente' : null
    }

    out.push({
      key: k,
      dia,
      frente: primeira.frente,
      encarregado: primeira.encarregado_display_nome ?? primeira.siga_encarregado_nome ?? null,
      servico,
      trechoNome,
      unidadeLabel: uLabel,
      ini: { lat: primeira.lat, lng: primeira.lng, marcador: projIni ? marcadorFormatado(projIni) : null },
      fim: { lat: ultima.lat, lng: ultima.lng, marcador: projFim ? marcadorFormatado(projFim) : null },
      sentido,
      distanciaFmt: distanciaEntre(projIni, projFim, primeira, ultima),
      qtdTotal: qtdDoGrupo(
        qtdIdx,
        dia,
        primeira.frente,
        primeira.encarregado_display_nome ?? primeira.siga_encarregado_nome,
        primeira.servico_display_nome
      ),
      cor
    })
  }

  // Ordena por dia desc e depois por frente pra estabilidade visual.
  out.sort((a, b) => b.dia.localeCompare(a.dia) || (a.frente ?? '').localeCompare(b.frente ?? ''))
  return out
}

function distanciaEntre(
  projIni: ProjecaoTrecho | null,
  projFim: ProjecaoTrecho | null,
  primeira: FotoGeo,
  ultima: FotoGeo
): string | null {
  if (projIni && projFim) {
    return distanciaFormatada(
      projIni, projFim,
      primeira.lng, primeira.lat, ultima.lng, ultima.lat
    )
  }
  // Sem trecho casado: distância geodésica reta em metros.
  const m = haversineM(primeira.lat, primeira.lng, ultima.lat, ultima.lng)
  return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m (reta)`
}

export interface DiaSemFoto {
  dia: string
  frente: string | null
  encarregado: string | null
  servico: string | null
  qtd: number
}

/**
 * Grupos (dia × frente × encarregado × serviço) que TÊM produção lançada mas
 * NÃO têm nenhuma foto — logo não aparecem como seta na sequência de ataque.
 * Usado pra alertar o usuário sobre lacunas de cobertura fotográfica.
 */
export function producaoSemFoto(
  fotos: FotoEnriquecida[],
  producoes: ProducaoEnriquecida[]
): DiaSemFoto[] {
  const comFoto = new Set<string>()
  for (const f of fotos) {
    const dia = f.captured_date ?? (f.captured_at ? f.captured_at.slice(0, 10) : null)
    if (!dia) continue
    comFoto.add(chaveGrupo(dia, f.frente, f.encarregado_display_nome, f.servico_display_nome))
  }
  const agg = new Map<string, DiaSemFoto>()
  for (const p of producoes) {
    if (!p.data) continue
    const k = chaveGrupo(p.data, p.frente, p.encarregado_display_nome, p.servico_display_nome)
    if (comFoto.has(k)) continue
    const cur = agg.get(k) ?? {
      dia: p.data, frente: p.frente,
      encarregado: p.encarregado_display_nome ?? p.siga_encarregado_nome,
      servico: p.servico_display_nome ?? p.siga_servico_nome, qtd: 0
    }
    cur.qtd += Number(p.qtd_convertida ?? p.qtd) || 0
    agg.set(k, cur)
  }
  return Array.from(agg.values()).sort((a, b) => b.dia.localeCompare(a.dia))
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
