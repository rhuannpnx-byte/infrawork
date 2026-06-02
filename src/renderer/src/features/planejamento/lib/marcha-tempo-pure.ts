// Marcha-Tempo (TILOS) — derivação de trajetória da frente de serviço.
//
// Algoritmo central (modo 'perfilada'):
//
//   1) Identifica `fatiasComTrabalho` = segmentos do template com `valor > 0`,
//      cortados ao range [posIni, posFim] da tarefa. Fatias com valor=0 (ou
//      gaps sem cobertura no template) são EXCLUÍDAS — a frente "salta" sobre
//      elas sem consumir tempo, gerando ilhas separadas na polilinha.
//   2) Quantidade acumulada no tempo: perfil_semanas → soma cumulativa por
//      semana, normalizada pelo qtdTotalPerfil.
//   3) Pra cada semana w, calcula qAlvo = fração × qTotalEspacial e localiza
//      a fatia onde essa quantidade cai + posição interna. Adiciona ponto
//      `(fim_da_semana, p_w)` à ilha da fatia.
//   4) Quando uma semana muda de fatia, fecha a ilha anterior no fim da
//      fatia anterior (mesma data) e abre nova ilha no início da próxima
//      fatia — frente "salta" instantaneamente.
//
// Quando faltam dados (sem qtd_link, sem template, sem perfil_semanas, ou
// sem fatias com trabalho), modo 'uniforme': uma única ilha com 2 pontos
// = polilinha = linha reta entre extremos.
//
// Helpers são puros — testáveis em isolamento (sem React/Supabase).

import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import type {
  GranularidadeTempo,
  PontoTraco,
  SemanaPerfil
} from '@/types/planejamento'

const DAY = 86400000

// ─── Paleta categórica de cores por código de serviço ──────────────────────
//
// Hash determinístico do código → índice na paleta. Usado tanto pra colorir
// a polilinha da tarefa (TracoTarefa.cor) quanto pra colorir o bloco de
// quantidades da MESMA coluna do template (assumindo `nome da coluna do
// template == servico_grupo_codigo + descrição`, ou que o usuário cria
// colunas com nomes derivados do código do serviço).

const PALETA_SERVICOS = [
  '#60a5fa', // azul
  '#34d399', // verde
  '#fbbf24', // âmbar
  '#f87171', // vermelho
  '#a78bfa', // violeta
  '#f472b6', // rosa
  '#2dd4bf', // teal
  '#fb923c'  // laranja
]

/**
 * Cor categórica determinística a partir de uma chave (código do serviço,
 * nome de coluna do template, etc). Mesma chave → mesma cor sempre, em todos
 * os componentes que usam essa função.
 */
export function corDoServico(chave: string | null | undefined): string {
  const k = chave ?? ''
  let hash = 0
  for (let i = 0; i < k.length; i++) hash = (hash * 31 + k.charCodeAt(i)) | 0
  return PALETA_SERVICOS[Math.abs(hash) % PALETA_SERVICOS.length]
}

// ─── Fatias com trabalho ────────────────────────────────────────────────────

export interface FatiaTrabalho {
  /** Início no eixo posição (sempre em ordem natural — independente da direção). */
  ini: number
  /** Fim no eixo posição (≥ ini). */
  fim: number
  /** Valor da fatia, ponderado pela fração de cobertura no range da tarefa. */
  valor: number
}

/**
 * Gera fatias com trabalho real (valor > 0) no range [posIni, posFim] da tarefa,
 * ordenadas NA DIREÇÃO de avanço (ascendente se posFim ≥ posIni; descendente
 * caso contrário).
 *
 * Cada fatia é o pedaço de um segmento do template que cai dentro do range
 * da tarefa. Segmentos com valor=0 e regiões sem cobertura são EXCLUÍDAS —
 * isso faz a polilinha "pular" essas regiões via ilhas separadas.
 */
export function fatiasComTrabalho(
  posIni: number,
  posFim: number,
  segmentos: Array<{ posicao_inicio_m: number; posicao_fim_m: number; valor: number }>
): FatiaTrabalho[] {
  const lo = Math.min(posIni, posFim)
  const hi = Math.max(posIni, posFim)
  const out: FatiaTrabalho[] = []
  for (const seg of segmentos) {
    if (!(seg.valor > 0)) continue
    if (!Number.isFinite(seg.valor)) continue
    const segLo = Math.min(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segHi = Math.max(seg.posicao_inicio_m, seg.posicao_fim_m)
    const segLen = segHi - segLo
    if (segLen <= 0) continue
    const interLo = Math.max(lo, segLo)
    const interHi = Math.min(hi, segHi)
    const interLen = interHi - interLo
    if (interLen <= 0) continue
    // Valor ponderado pela fração do segmento contida no range da tarefa.
    const valorEfetivo = seg.valor * (interLen / segLen)
    if (valorEfetivo <= 0) continue
    out.push({ ini: interLo, fim: interHi, valor: valorEfetivo })
  }
  const dir = posFim >= posIni ? 1 : -1
  // Ordena na direção de avanço (ini ascendente pra dir=1; fim descendente pra dir=-1).
  out.sort((a, b) => (dir === 1 ? a.ini - b.ini : b.fim - a.fim))
  return out
}

/** Soma dos valores das fatias com trabalho. */
export function qtdTotalFatias(fatias: FatiaTrabalho[]): number {
  let acc = 0
  for (const f of fatias) acc += f.valor
  return acc
}

// ─── Perfil semanal acumulado ──────────────────────────────────────────────

export function acumularPerfilSemanal(
  perfil: SemanaPerfil[]
): Array<{ semanaSegunda: string; qtdAcumulada: number }> {
  let acc = 0
  return perfil.map((s) => {
    acc += Number(s.quantidade_planejada) || 0
    return { semanaSegunda: s.semana_segunda, qtdAcumulada: acc }
  })
}

/** Domingo (fim de semana) a partir da segunda-feira ISO. */
export function fimDaSemana(segundaIso: string): string {
  const d = new Date(`${segundaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

// ─── Localizador: qual fatia + posição interna ──────────────────────────────

interface LocalQ {
  idxFatia: number
  /** Posição em metros dentro da fatia, respeitando direção. */
  pos: number
}

function localizarQAcumulada(
  qAlvo: number,
  fatias: FatiaTrabalho[],
  acumFatias: number[],
  dir: 1 | -1
): LocalQ {
  if (fatias.length === 0) return { idxFatia: 0, pos: 0 }
  if (qAlvo <= 0) {
    const f = fatias[0]
    return { idxFatia: 0, pos: dir === 1 ? f.ini : f.fim }
  }
  const qTotal = acumFatias[acumFatias.length - 1]
  if (qAlvo >= qTotal) {
    const idx = fatias.length - 1
    const f = fatias[idx]
    return { idxFatia: idx, pos: dir === 1 ? f.fim : f.ini }
  }
  // Procura primeira fatia tal que acumFatias[idx] >= qAlvo
  let idx = 0
  while (idx < fatias.length && acumFatias[idx] < qAlvo) idx++
  const f = fatias[idx]
  const consumidoAntes = idx > 0 ? acumFatias[idx - 1] : 0
  const restante = qAlvo - consumidoAntes
  const frac = f.valor > 0 ? restante / f.valor : 0
  const len = f.fim - f.ini
  const pos = dir === 1 ? f.ini + frac * len : f.fim - frac * len
  return { idxFatia: idx, pos }
}

// ─── Trajetória perfilada — ilhas ──────────────────────────────────────────

interface TracarPerfiladaParams {
  dataInicio: string
  dataFim: string
  posIni: number
  posFim: number
  segmentosColuna: Array<{ posicao_inicio_m: number; posicao_fim_m: number; valor: number }>
  perfil: SemanaPerfil[]
  /**
   * Resolução da polilinha em DIAS. Define o passo de samples entre pontos.
   *   1  → ponto por dia (granularidade diária)
   *   7  → ponto por semana
   *   30 → ponto por mês
   * Mapeia diretamente da granularidade da UI. Resolução mais fina = curva
   * mais suave; mais grossa = curva com menos vértices.
   */
  resolucaoDias?: number
}

/** Mapeia granularidade da UI pra resolução em dias. */
export function granularidadeParaResolucaoDias(
  ini: number,
  fim: number,
  granularidade: GranularidadeTempo
): number {
  const efet = granularidadeEfetiva(ini, fim, granularidade)
  if (efet === 'diario') return 1
  if (efet === 'semanal') return 7
  return 30
}

function dataMsLocal(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Constrói função `qAcumNoTempo(t)`: dado um timestamp t (ms), retorna a
 * quantidade acumulada do perfil ATÉ t. Interpola LINEARMENTE dentro de cada
 * semana ISO (semana_segunda + 7 dias). Pra t antes do perfil retorna 0;
 * depois do fim retorna qTotalPerfil.
 *
 * Internamente memoiza o índice da última semana consultada pra acelerar
 * varredura monotônica do tempo.
 */
function interpoladorQNoTempo(
  perfilAcumulado: Array<{ semanaSegunda: string; qtdAcumulada: number }>
): (t: number) => number {
  if (perfilAcumulado.length === 0) return () => 0
  const semanas = perfilAcumulado.map((s, i) => {
    const tIni = dataMsLocal(s.semanaSegunda)
    const tFim = tIni + 7 * DAY
    const qIni = i === 0 ? 0 : perfilAcumulado[i - 1].qtdAcumulada
    const qFim = s.qtdAcumulada
    return { tIni, tFim, qIni, qFim }
  })
  const qTotal = perfilAcumulado[perfilAcumulado.length - 1].qtdAcumulada
  return (t: number): number => {
    if (t <= semanas[0].tIni) return 0
    if (t >= semanas[semanas.length - 1].tFim) return qTotal
    // Busca semana correspondente (linear; perf OK pra ≤ 100 semanas)
    for (const s of semanas) {
      if (t < s.tFim) {
        if (t <= s.tIni) return s.qIni
        const frac = (t - s.tIni) / (s.tFim - s.tIni)
        return s.qIni + (s.qFim - s.qIni) * frac
      }
    }
    return qTotal
  }
}

/**
 * Trajetória perfilada em ilhas. Cada ilha = polilinha contínua dentro de uma
 * fatia com trabalho > 0. Quando dois samples consecutivos cruzam pra outra
 * fatia, fecha a ilha atual no fim da fatia anterior (mesma data) e abre
 * nova ilha no início da próxima fatia — frente "salta" instantaneamente
 * sobre regiões sem trabalho.
 *
 * Resolução temporal controlada por `resolucaoDias` (default 7). Polilinha
 * tem 1 ponto a cada `resolucaoDias` dias entre dataInicio e dataFim,
 * garantindo que o último sample seja EXATAMENTE em dataFim (evita "L
 * horizontal" no fim).
 *
 * Retorna [] (sem ilhas) quando faltam dados. Caller usa tracarUniforme.
 */
export function tracarPerfiladaIlhas(params: TracarPerfiladaParams): PontoTraco[][] {
  const {
    dataInicio,
    dataFim,
    posIni,
    posFim,
    segmentosColuna,
    perfil,
    resolucaoDias = 7
  } = params
  if (!perfil.length || !segmentosColuna.length) return []
  if (posIni === posFim) {
    return [
      [
        { data: dataInicio, posicaoM: posIni },
        { data: dataFim, posicaoM: posFim }
      ]
    ]
  }

  const fatias = fatiasComTrabalho(posIni, posFim, segmentosColuna)
  if (fatias.length === 0) return []

  const qTotal = qtdTotalFatias(fatias)
  if (qTotal <= 0) return []

  const dir: 1 | -1 = posFim >= posIni ? 1 : -1
  const acumulado = acumularPerfilSemanal(perfil)
  const qTotalPerfil = acumulado[acumulado.length - 1]?.qtdAcumulada ?? 0
  if (qTotalPerfil <= 0) return []

  // Acumulado de qtd por fatia (pra busca em localizarQ)
  const acumFatias: number[] = []
  let acc = 0
  for (const f of fatias) {
    acc += f.valor
    acumFatias.push(acc)
  }

  const inicioFatia = (idx: number): number => (dir === 1 ? fatias[idx].ini : fatias[idx].fim)
  const fimFatia = (idx: number): number => (dir === 1 ? fatias[idx].fim : fatias[idx].ini)

  const tIni = dataMsLocal(dataInicio)
  const tFim = dataMsLocal(dataFim)
  if (tFim <= tIni) {
    // Tarefa degenerada (mesmo dia) — apenas 2 pontos extremos
    return [
      [
        { data: dataInicio, posicaoM: inicioFatia(0) },
        { data: dataFim, posicaoM: fimFatia(fatias.length - 1) }
      ]
    ]
  }

  // Calcula nSamples baseado na resolução. Sempre garante ≥ 4 pontos e ≤ 400
  // (caps razoáveis pro tamanho de dados típico).
  const totalDias = Math.max(1, (tFim - tIni) / DAY)
  const passo = Math.max(1, Math.round(resolucaoDias))
  const nSamples = Math.max(4, Math.min(400, Math.ceil(totalDias / passo)))

  const qNoTempo = interpoladorQNoTempo(acumulado)

  // Coleta amostras (t, q, idxFatia, pos)
  type Sample = { t: number; data: string; idxFatia: number; pos: number }
  const samples: Sample[] = []
  for (let i = 0; i <= nSamples; i++) {
    const t = tIni + (i / nSamples) * (tFim - tIni)
    const q = qNoTempo(t)
    const fracao = qTotalPerfil > 0 ? q / qTotalPerfil : 0
    const qAlvo = fracao * qTotal
    const { idxFatia, pos } = localizarQAcumulada(qAlvo, fatias, acumFatias, dir)
    samples.push({ t, data: msToIso(t), idxFatia, pos })
  }

  // Garante último sample exatamente em (dataFim, fimFatia(last)) — evita
  // L horizontal por drift de arredondamento.
  if (samples.length > 0) {
    const last = samples[samples.length - 1]
    last.t = tFim
    last.data = dataFim
    last.idxFatia = fatias.length - 1
    last.pos = fimFatia(fatias.length - 1)
  }

  // Build de ilhas via processamento sequencial dos samples
  const ilhas: PontoTraco[][] = []
  let ilhaAtual: PontoTraco[] = []
  let fatiaAtual = -1

  for (const s of samples) {
    if (s.idxFatia !== fatiaAtual) {
      // Cruza pra outra fatia. Fecha a ilha atual no fim da fatia anterior,
      // abre nova ilha no início da próxima fatia (mesma data — salto invisível
      // no tempo, salto visível no espaço).
      if (fatiaAtual >= 0 && ilhaAtual.length > 0) {
        ilhaAtual.push({ data: s.data, posicaoM: fimFatia(fatiaAtual) })
        if (ilhaAtual.length >= 2) ilhas.push(ilhaAtual)
      }
      // Cobre fatias intermediárias se a frente "pulou" várias de uma vez
      for (let k = fatiaAtual + 1; k < s.idxFatia; k++) {
        ilhas.push([
          { data: s.data, posicaoM: inicioFatia(k) },
          { data: s.data, posicaoM: fimFatia(k) }
        ])
      }
      ilhaAtual = [{ data: s.data, posicaoM: inicioFatia(s.idxFatia) }]
      fatiaAtual = s.idxFatia
    }
    // Evita ponto duplicado no início da ilha (mesma data + posicao)
    const last = ilhaAtual[ilhaAtual.length - 1]
    if (!last || last.data !== s.data || Math.abs(last.posicaoM - s.pos) > 0.001) {
      ilhaAtual.push({ data: s.data, posicaoM: s.pos })
    }
  }

  // Fecha última ilha
  if (ilhaAtual.length >= 2) ilhas.push(ilhaAtual)

  return ilhas.filter((ilha) => ilha.length >= 2)
}

/** Modo uniforme: 1 ilha com 2 pontos (linha reta entre extremos). */
export function tracarUniforme(params: {
  dataInicio: string
  dataFim: string
  posIni: number
  posFim: number
}): PontoTraco[][] {
  return [
    [
      { data: params.dataInicio, posicaoM: params.posIni },
      { data: params.dataFim, posicaoM: params.posFim }
    ]
  ]
}

// ─── Adaptador: segmentos por coluna ───────────────────────────────────────

/**
 * Extrai segmentos do template pra uma coluna específica (por nome). Retorna
 * lista pronta pra `fatiasComTrabalho`. Vazia se template/coluna ausente.
 */
export function segmentosPorColuna(
  template: TrechoQuantidadeVersaoCompleta | null,
  nomeColuna: string | null | undefined
): Array<{ posicao_inicio_m: number; posicao_fim_m: number; valor: number }> {
  if (!template || !nomeColuna) return []
  const col = template.colunas.find((c) => c.nome === nomeColuna)
  if (!col) return []
  const out: Array<{ posicao_inicio_m: number; posicao_fim_m: number; valor: number }> = []
  for (const seg of template.segmentos) {
    const valor = seg.valores[col.id]
    if (typeof valor !== 'number' || !Number.isFinite(valor)) continue
    out.push({
      posicao_inicio_m: seg.posicao_inicio_m,
      posicao_fim_m: seg.posicao_fim_m,
      valor
    })
  }
  return out
}

// ─── Ticks de tempo ────────────────────────────────────────────────────────

/**
 * Gera timestamps (ms) pra ticks do eixo tempo. Granularidade explícita:
 *   * 'diario'  — 1 tick por dia (cap 60 ticks)
 *   * 'semanal' — segunda-feira de cada semana ISO
 *   * 'mensal'  — primeiro dia de cada mês
 *   * 'auto'    — escolhe baseado no span (≤14d→diário, ≤90d→semanal, senão mensal)
 *
 * Sempre snap ao início da unidade (segunda/primeiro do mês) e limita a 60
 * ticks pra evitar render explosion em spans muito longos.
 */
export function gerarTicksTempo(
  ini: number,
  fim: number,
  granularidade: GranularidadeTempo
): number[] {
  const span = fim - ini
  if (!Number.isFinite(span) || span <= 0) return [ini]

  let gran: GranularidadeTempo = granularidade
  if (gran === 'auto') {
    if (span <= 14 * DAY) gran = 'diario'
    else if (span <= 90 * DAY) gran = 'semanal'
    else gran = 'mensal'
  }

  const out: number[] = []
  // Cap alto pro grid ficar denso (diário em 6+ meses ≈ 180 ticks).
  // Em ranges absurdos (>5 anos diário), trunca pra preservar perf.
  const cap = 1000

  if (gran === 'mensal') {
    const d = new Date(ini)
    d.setUTCDate(1)
    d.setUTCHours(0, 0, 0, 0)
    if (d.getTime() < ini) d.setUTCMonth(d.getUTCMonth() + 1)
    while (d.getTime() <= fim && out.length < cap) {
      out.push(d.getTime())
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
  } else if (gran === 'semanal') {
    const d = new Date(ini)
    const dow = d.getUTCDay() // 0=dom, 1=seg, ..., 6=sab
    const ajuste = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow
    d.setUTCDate(d.getUTCDate() + ajuste)
    d.setUTCHours(0, 0, 0, 0)
    while (d.getTime() <= fim && out.length < cap) {
      out.push(d.getTime())
      d.setUTCDate(d.getUTCDate() + 7)
    }
  } else {
    // diario
    const d = new Date(ini)
    d.setUTCHours(0, 0, 0, 0)
    if (d.getTime() < ini) d.setUTCDate(d.getUTCDate() + 1)
    while (d.getTime() <= fim && out.length < cap) {
      out.push(d.getTime())
      d.setUTCDate(d.getUTCDate() + 1)
    }
  }
  if (out.length === 0) out.push(ini)
  return out
}

/** Granularidade efetiva (resolve 'auto'). Útil pra label formatter. */
export function granularidadeEfetiva(
  ini: number,
  fim: number,
  granularidade: GranularidadeTempo
): Exclude<GranularidadeTempo, 'auto'> {
  if (granularidade !== 'auto') return granularidade
  const span = fim - ini
  if (span <= 14 * DAY) return 'diario'
  if (span <= 90 * DAY) return 'semanal'
  return 'mensal'
}

// ─── Ticks de posição ──────────────────────────────────────────────────────

/**
 * Gera ticks (em metros) pro eixo posição. Quando `passoM` é null, escolhe
 * passo "amigável" (1/2/5 × 10^k) baseado no span. Quando setado, usa o passo
 * direto. Cap em 50 ticks.
 */
export function gerarTicksPosicao(
  ini: number,
  fim: number,
  passoM: number | null
): number[] {
  const lo = Math.min(ini, fim)
  const hi = Math.max(ini, fim)
  const span = hi - lo
  if (!Number.isFinite(span) || span <= 0) return [lo]

  let passo: number
  if (passoM != null && passoM > 0) {
    passo = passoM
  } else {
    const passoBruto = span / 8
    const exp = Math.floor(Math.log10(passoBruto))
    const base = Math.pow(10, exp)
    const candidatos = [1, 2, 5, 10].map((m) => m * base)
    passo = candidatos.find((c) => c >= passoBruto) ?? candidatos[candidatos.length - 1]
  }

  const out: number[] = []
  const first = Math.ceil(lo / passo) * passo
  // Cap alto pra grid denso ao escolher passo fino (ex: 100m em trecho 250km
  // = 2500 ticks). Trunca pra preservar perf em ranges absurdos.
  const cap = 2000
  for (let v = first; v <= hi + passo * 0.001 && out.length < cap; v += passo) {
    out.push(v)
  }
  return out
}
