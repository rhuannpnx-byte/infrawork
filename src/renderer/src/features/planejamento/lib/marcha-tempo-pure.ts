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

/** Código embutido no início do nome (ex.: "005 Micro" → "005"). */
export function extrairCodigoColuna(nome: string): string {
  return nome.match(/^\s*([\w.-]+)/)?.[1] ?? nome
}

/** Normaliza texto p/ casar nome de coluna ↔ descrição de série (sem acento/caixa). */
function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Série do plot (trajetória) usada p/ casar cor com a faixa de quantidades. */
export interface SerieCorRef {
  /** Chave em estilosSerie (servico_grupo_codigo). */
  codigo: string
  /** Rótulo "codigo · descricao". */
  label: string
  /** Cor padrão da série (corDaTarefa). */
  cor: string
}

/**
 * Resolve a cor de cada coluna de quantidades casando-a com a série do plot,
 * para que a barra de quantidades use EXATAMENTE a mesma cor da trajetória do
 * serviço (inclusive a cor custom escolhida no painel de séries).
 *
 * Casamento, em ordem: (1) código no início do nome da coluna == série.codigo;
 * (2) nome da coluna == descrição da série (normalizado, sem acento/caixa).
 * Sem casamento → hash determinístico (corDoServico) sobre o código extraído.
 */
export function resolverCoresColunas(
  nomesColunas: string[],
  series: SerieCorRef[],
  estilos: Record<string, { cor?: string } | undefined>
): Record<string, string> {
  const porCodigo = new Map<string, SerieCorRef>()
  const porDescricao = new Map<string, SerieCorRef>()
  for (const s of series) {
    if (s.codigo && !porCodigo.has(s.codigo)) porCodigo.set(s.codigo, s)
    const desc = normalizarNome(s.label.replace(/^\s*[\w.-]+\s*[·•\-–]?\s*/, ''))
    if (desc && !porDescricao.has(desc)) porDescricao.set(desc, s)
  }
  const out: Record<string, string> = {}
  for (const nome of nomesColunas) {
    const code = extrairCodigoColuna(nome)
    const serie = porCodigo.get(code) ?? porDescricao.get(normalizarNome(nome))
    const chave = serie?.codigo ?? code
    out[nome] = estilos[chave]?.cor ?? serie?.cor ?? corDoServico(code)
  }
  return out
}

// ─── Faixa de quantidades: clusterização + densidade ────────────────────────
//
// Lógica ÚNICA usada tanto na visualização interativa (MarchaTempoFaixaQuantidades)
// quanto na impressão/export (MarchaTempoExport) — garante que a barra de
// quantidades tenha clusterização e gradiente idênticos nos dois.

export interface ClusterQtd {
  ini: number
  fim: number
  valor: number
  count: number
  vmin: number
  vmax: number
  /** Soma de (valor/metro) por segmento — base da média de densidade. */
  sumDensidade: number
}

/** Desvio-padrão da densidade (valor/metro) dos segmentos — base da segregação. */
export function desvioDensidadeSegs(
  segs: Array<{ ini: number; fim: number; valor: number }>
): number {
  const dens = segs.map((s) => s.valor / Math.max(1, s.fim - s.ini))
  if (dens.length === 0) return 0
  const mean = dens.reduce((a, b) => a + b, 0) / dens.length
  const varr = dens.reduce((a, b) => a + (b - mean) ** 2, 0) / dens.length
  return Math.sqrt(varr)
}

/**
 * Cluster de segmentos contíguos com segregação por desvio de densidade + cap
 * anti-supercluster. Regras:
 *  1) Largura mínima (`minLabelPx`) antes de fechar (pra caber o valor escrito).
 *  2) Segregação: segmento que desvia > 1× std da densidade média do cluster
 *     fecha o cluster (destaca mudanças de densidade).
 *  3) Cap (`maxClusterPx`): cluster largo demais força fechamento.
 *  4) Gap visual > 1.5px conta como separador.
 */
export function clusterizarSegmentos(
  segs: Array<{ ini: number; fim: number; valor: number }>,
  sx: (m: number) => number,
  innerW: number,
  minLabelPx: number,
  stdDensidade: number,
  maxClusterPx: number
): ClusterQtd[] {
  if (segs.length === 0) return []
  const out: ClusterQtd[] = []
  let atual: ClusterQtd | null = null
  const GAP_PX = 1.5
  const K_SEGREGA = 1.0
  const stdEfetivo = Math.max(stdDensidade, 1e-9)

  for (const s of segs) {
    const xIni = sx(s.ini)
    const xFim = sx(s.fim)
    if (xFim < 0 || xIni > innerW) continue
    const compS = Math.max(1, s.fim - s.ini)
    const densS = s.valor / compS

    if (!atual) {
      atual = {
        ini: s.ini,
        fim: s.fim,
        valor: s.valor,
        count: 1,
        vmin: s.valor,
        vmax: s.valor,
        sumDensidade: densS
      }
      continue
    }

    const xAtualFim = sx(atual.fim)
    const gapPx = xIni - xAtualFim
    const wAtual = xAtualFim - sx(atual.ini)
    const mediaDensAtual = atual.sumDensidade / atual.count
    const desvio = Math.abs(densS - mediaDensAtual)
    const segregaPorDensidade = desvio > K_SEGREGA * stdEfetivo

    const podeFechar = wAtual >= minLabelPx
    const motivoNormal = podeFechar && (gapPx > GAP_PX || segregaPorDensidade)
    const motivoCap = wAtual >= maxClusterPx
    if (motivoNormal || motivoCap) {
      out.push(atual)
      atual = {
        ini: s.ini,
        fim: s.fim,
        valor: s.valor,
        count: 1,
        vmin: s.valor,
        vmax: s.valor,
        sumDensidade: densS
      }
    } else {
      atual.fim = s.fim
      atual.valor += s.valor
      atual.count += 1
      atual.vmin = Math.min(atual.vmin, s.valor)
      atual.vmax = Math.max(atual.vmax, s.valor)
      atual.sumDensidade += densS
    }
  }
  if (atual) out.push(atual)
  return out
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
  // Pré-computa por semana: timestamps dos dias úteis (seg-sex menos feriados),
  // mais qIni/qFim acumulado. Permite uma curva FIEL à velocidade real:
  // q cresce APENAS nos dias úteis; fica HORIZONTAL em sábados/domingos/feriados.
  interface SemanaInfo {
    tIni: number
    tFim: number
    qIni: number
    qFim: number
    diasUteis: number[] // timestamps (à meia-noite) dos dias úteis dessa semana
  }
  const semanas: SemanaInfo[] = perfilAcumulado.map((s, i) => {
    const tIni = dataMsLocal(s.semanaSegunda)
    const tFim = tIni + 7 * DAY
    const qIni = i === 0 ? 0 : perfilAcumulado[i - 1].qtdAcumulada
    const qFim = s.qtdAcumulada
    const diasUteis: number[] = []
    for (let d = 0; d < 7; d++) {
      const ts = tIni + d * DAY
      if (ehDiaUtil(ts)) diasUteis.push(ts)
    }
    return { tIni, tFim, qIni, qFim, diasUteis }
  })
  const qTotal = perfilAcumulado[perfilAcumulado.length - 1].qtdAcumulada
  return (t: number): number => {
    if (t <= semanas[0].tIni) return 0
    if (t >= semanas[semanas.length - 1].tFim) return qTotal
    for (const s of semanas) {
      if (t < s.tFim) {
        if (t <= s.tIni) return s.qIni
        const span = s.qFim - s.qIni
        if (s.diasUteis.length === 0 || span <= 0) {
          // Semana inteira não-útil ou sem progresso → q fica em qIni
          return s.qIni
        }
        // Cada dia útil "ganha" 1/N da quantidade da semana. Dentro do dia
        // útil, distribui linearmente em 24h. Em dias não-úteis, q fica
        // igual ao acumulado do último dia útil concluído.
        const perDia = span / s.diasUteis.length
        let qLocal = 0
        for (const dIni of s.diasUteis) {
          const dFim = dIni + DAY
          if (t >= dFim) {
            qLocal += perDia
          } else if (t > dIni) {
            // Dia útil em andamento — distribui linearmente nas 24h
            const frac = (t - dIni) / DAY
            qLocal += perDia * frac
            return s.qIni + qLocal
          } else {
            // t cai antes deste dia útil (pode ser fim-de-semana intermediário)
            return s.qIni + qLocal
          }
        }
        return s.qIni + qLocal
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

  // Sampling DIÁRIO sempre: permite que a curva represente a velocidade real
  // do serviço dia-a-dia (slope local = m/dia naquele momento). O parâmetro
  // resolucaoDias é mantido como fallback pra tarefas muito longas (cap em
  // 400 samples), mas o passo mínimo é 1 dia.
  const totalDias = Math.max(1, (tFim - tIni) / DAY)
  const passoSolicitado = Math.max(1, Math.round(resolucaoDias))
  // Force passo=1 (diário) se a tarefa cabe em 400 amostras
  const passo = totalDias <= 400 ? 1 : passoSolicitado
  const nSamples = Math.max(4, Math.min(400, Math.ceil(totalDias / passo)))

  const qNoTempo = interpoladorQNoTempo(acumulado)

  // Coleta amostras (t, q, idxFatia, pos). qAcc/qDia REAIS: qAcc = q absoluta
  // do perfil de tempo (cresce monotonicamente 0→qTotal); qDia = delta vs
  // sample anterior (≈ produção do dia).
  type Sample = {
    t: number
    data: string
    idxFatia: number
    pos: number
    qAcc: number
    qDia: number
  }
  const samples: Sample[] = []
  for (let i = 0; i <= nSamples; i++) {
    const t = tIni + (i / nSamples) * (tFim - tIni)
    const q = qNoTempo(t)
    const fracao = qTotalPerfil > 0 ? q / qTotalPerfil : 0
    const qAlvo = fracao * qTotal
    const { idxFatia, pos } = localizarQAcumulada(qAlvo, fatias, acumFatias, dir)
    const qAcc = qAlvo // já está na unidade do qtd_link (real, não fração)
    const qDia = i > 0 ? Math.max(0, qAcc - samples[i - 1].qAcc) : 0
    samples.push({ t, data: msToIso(t), idxFatia, pos, qAcc, qDia })
  }

  // Garante último sample exatamente em (dataFim, fimFatia(last)) — evita
  // L horizontal por drift de arredondamento.
  if (samples.length > 0) {
    const last = samples[samples.length - 1]
    last.t = tFim
    last.data = dataFim
    last.idxFatia = fatias.length - 1
    last.pos = fimFatia(fatias.length - 1)
    last.qAcc = qTotal
  }

  // Build de ilhas via processamento sequencial dos samples
  const ilhas: PontoTraco[][] = []
  let ilhaAtual: PontoTraco[] = []
  let fatiaAtual = -1
  let qAccUltimoSample = 0

  for (const s of samples) {
    if (s.idxFatia !== fatiaAtual) {
      // Cruza pra outra fatia. Fecha a ilha atual no fim da fatia anterior,
      // abre nova ilha no início da próxima fatia (mesma data — salto invisível
      // no tempo, salto visível no espaço). Nos pontos sintéticos do salto,
      // qAcc é preservado (não se ganha quantidade no gap).
      if (fatiaAtual >= 0 && ilhaAtual.length > 0) {
        ilhaAtual.push({
          data: s.data,
          posicaoM: fimFatia(fatiaAtual),
          qtdAcc: qAccUltimoSample,
          qtdDia: 0
        })
        if (ilhaAtual.length >= 2) ilhas.push(ilhaAtual)
      }
      // Cobre fatias intermediárias se a frente "pulou" várias de uma vez
      for (let k = fatiaAtual + 1; k < s.idxFatia; k++) {
        ilhas.push([
          {
            data: s.data,
            posicaoM: inicioFatia(k),
            qtdAcc: qAccUltimoSample,
            qtdDia: 0
          },
          {
            data: s.data,
            posicaoM: fimFatia(k),
            qtdAcc: qAccUltimoSample,
            qtdDia: 0
          }
        ])
      }
      ilhaAtual = [
        {
          data: s.data,
          posicaoM: inicioFatia(s.idxFatia),
          qtdAcc: qAccUltimoSample,
          qtdDia: 0
        }
      ]
      fatiaAtual = s.idxFatia
    }
    // Evita ponto duplicado no início da ilha (mesma data + posicao)
    const last = ilhaAtual[ilhaAtual.length - 1]
    if (!last || last.data !== s.data || Math.abs(last.posicaoM - s.pos) > 0.001) {
      ilhaAtual.push({
        data: s.data,
        posicaoM: s.pos,
        qtdAcc: s.qAcc,
        qtdDia: s.qDia
      })
    }
    qAccUltimoSample = s.qAcc
  }

  // Fecha última ilha
  if (ilhaAtual.length >= 2) ilhas.push(ilhaAtual)

  return ilhas.filter((ilha) => ilha.length >= 2)
}

/** Modo uniforme: 1 ilha com 2 pontos (linha reta entre extremos). qtdTotal
 *  opcional propaga a quantidade entre os pontos extremos (0 → qtdTotal). */
export function tracarUniforme(params: {
  dataInicio: string
  dataFim: string
  posIni: number
  posFim: number
  qtdTotal?: number
}): PontoTraco[][] {
  const qt = params.qtdTotal ?? 0
  return [
    [
      { data: params.dataInicio, posicaoM: params.posIni, qtdAcc: 0, qtdDia: 0 },
      { data: params.dataFim, posicaoM: params.posFim, qtdAcc: qt, qtdDia: 0 }
    ]
  ]
}

/**
 * Pós-processamento: junta ilhas consecutivas separadas por gaps PEQUENOS no
 * eixo posição. Mantém apenas gaps significativos (frente realmente "salta").
 *
 * Gap entre ilhas A e B = |posicaoM(último ponto de A) − posicaoM(primeiro
 * ponto de B)|. Threshold default = max(2500m, 2.5% do range total da tarefa).
 *
 * Concatena pontos diretamente — a linha natural entre o último ponto de A e
 * o primeiro de B representa a passagem da frente pelo gap. Sem inserir
 * pontos sintéticos (evita ruído visual).
 */
export function joinIlhasProximas(
  ilhas: PontoTraco[][],
  posIni: number,
  posFim: number,
  opts?: { thresholdAbsM?: number; thresholdRel?: number }
): PontoTraco[][] {
  if (ilhas.length < 2) return ilhas
  // Threshold APERTADO: só une ilhas separadas por gaps realmente pequenos
  // (< 800m absoluto OU < 1.2% do range total — o que for maior).
  const thrAbs = opts?.thresholdAbsM ?? 800
  const thrRel = opts?.thresholdRel ?? 0.012
  const total = Math.abs(posFim - posIni)
  const threshold = Math.max(thrAbs, thrRel * total)

  const out: PontoTraco[][] = []
  let atual: PontoTraco[] = [...ilhas[0]]
  for (let i = 1; i < ilhas.length; i++) {
    const last = atual[atual.length - 1]
    const next = ilhas[i]
    const first = next[0]
    if (!last || !first) {
      atual = [...next]
      continue
    }
    const gap = Math.abs(first.posicaoM - last.posicaoM)
    if (gap <= threshold) {
      // Junta: anexa os pontos da próxima ilha (pulando o primeiro se for
      // duplicado do último da atual)
      const start =
        first.data === last.data && Math.abs(first.posicaoM - last.posicaoM) < 0.001
          ? 1
          : 0
      for (let j = start; j < next.length; j++) atual.push(next[j])
    } else {
      // Gap significativo → fecha a ilha atual e começa nova
      if (atual.length >= 2) out.push(atual)
      atual = [...next]
    }
  }
  if (atual.length >= 2) out.push(atual)
  return out
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

// ─── Helpers v2 (port do design Claude Design — Plot redesenhado) ──────────

const FERIADOS = new Set<string>([
  '2026-06-04',
  '2026-07-09',
  '2026-09-07'
])

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function ehFeriado(ms: number): boolean {
  return FERIADOS.has(isoLocal(ms))
}

export function ehFimDeSemana(ms: number): boolean {
  const w = new Date(ms).getDay()
  return w === 0 || w === 6
}

export function ehDiaUtil(ms: number): boolean {
  return !ehFimDeSemana(ms) && !ehFeriado(ms)
}

export function meiaNoite(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const MES_LONGO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "sex · 24 jul" — usado no chip de data do crosshair */
export function fmtDataLonga(ms: number): string {
  const d = new Date(ms)
  return `${DIA_SEM[d.getDay()]} · ${pad2(d.getDate())} ${MES_LONGO[d.getMonth()]}`
}

/** "24/07" — formato curto dos ticks do eixo Y */
export function fmtDataBR(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`
}

/** Compacta quantidade: 1.234.567 → "1,2M" / 12.345 → "12k" / 234 → "234" */
export function fmtQtdCompact(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.', ',') + 'k'
  return String(Math.round(v))
}

/** Marcador curto sem decimais — usado em ticks. Ex: 45375.09 → "45+375" */
export function formatMarcadorCurto(m: number): string {
  const km = Math.floor(m / 1000)
  const rest = Math.round(m - km * 1000)
  return `${km}+${String(rest).padStart(3, '0')}`
}

// ─── Geometria: cruzamentos entre polilinhas (conflitos espaço-temporais) ──

export interface Ponto2D {
  x: number
  y: number
}

/** Interseção entre 2 segmentos (p1→p2) × (p3→p4). null = sem cruzamento. */
export function segInter(
  p1: Ponto2D,
  p2: Ponto2D,
  p3: Ponto2D,
  p4: Ponto2D
): Ponto2D | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-9) return null
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}

/** Distância ponto→segmento em px (usado pro hover near-line). */
export function distSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

// ─── Path builders (degrau cru vs suavizado Catmull-Rom→Bezier) ────────────

/** Polilinha em degraus retos. Usado pra modo Técnico/Encorpado. */
export function pathReto(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  return 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')
}

/** Catmull-Rom → Bezier cúbica. Usado pra modo Fluido (cadência contínua). */
export function pathSuave(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length < 3) return pathReto(pts)
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

// ─── Detecção de conflitos espaço-temporais entre trajetórias ──────────────

export interface ConflitoEspaco {
  posM: number
  dateMs: number
  a: string
  b: string
}

/**
 * Detecta conflitos espaço-temporais reais entre frentes:
 *
 * Conflito real = duas frentes de **serviços distintos** (códigos
 * diferentes) ocupam aproximadamente a mesma posição no mesmo dia. Não
 * trata como conflito quando:
 *  - As duas frentes são do MESMO serviço (mesma equipe atuando, não
 *    competem por espaço-tempo).
 *  - O cruzamento ocorre em pontos extremos coincidentes (ex.: ambas
 *    começam no km 0 no dia 0).
 *  - Múltiplos cruzamentos no mesmo "vizinhança" (km ± 500m e dia ± 1) —
 *    deduplicados para um único conflito representativo.
 *
 * Sampling DENSO: usa TODOS os pontos das ilhas (não pula via STEP) pra
 * detectar com precisão. Custo O(N²·M²) com N tarefas e M pontos médios;
 * típico (10 tarefas × 100 pontos) ≈ 100k operações — instantâneo.
 */
export function detectarConflitos(
  tracos: Array<{
    tarefaId: string
    codigo: string | null
    ilhas: Array<Array<{ data: string; posicaoM: number }>>
  }>
): ConflitoEspaco[] {
  // Achata cada trajetória em pontos ordenados (sem STEP — full density)
  const pts = tracos.map((t) => {
    const flat: Array<{ x: number; y: number }> = []
    for (const ilha of t.ilhas) {
      for (const p of ilha) {
        flat.push({
          x: p.posicaoM,
          y: new Date(`${p.data}T00:00:00Z`).getTime()
        })
      }
    }
    return flat
  })

  const candidatos: ConflitoEspaco[] = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      // Filtro 1: mesmo serviço → não é conflito (mesma equipe)
      const codI = tracos[i].codigo
      const codJ = tracos[j].codigo
      if (codI && codJ && codI === codJ) continue

      const A = pts[i]
      const B = pts[j]
      for (let a = 0; a < A.length - 1; a++) {
        for (let b = 0; b < B.length - 1; b++) {
          const hit = segInter(A[a], A[a + 1], B[b], B[b + 1])
          if (!hit) continue
          // Filtro 2: rejeita cruzamento em endpoints coincidentes (início
          // ou fim quase exato de qualquer das duas trajetórias).
          const proximoIniA = Math.hypot(
            hit.x - A[0].x,
            (hit.y - A[0].y) / DAY
          )
          const proximoFimA = Math.hypot(
            hit.x - A[A.length - 1].x,
            (hit.y - A[A.length - 1].y) / DAY
          )
          const proximoIniB = Math.hypot(
            hit.x - B[0].x,
            (hit.y - B[0].y) / DAY
          )
          const proximoFimB = Math.hypot(
            hit.x - B[B.length - 1].x,
            (hit.y - B[B.length - 1].y) / DAY
          )
          const TOL_ENDPOINT = 600 // 600m ou ~600 dias (≈ 1.6 anos) — leve
          if (
            proximoIniA < TOL_ENDPOINT ||
            proximoFimA < TOL_ENDPOINT ||
            proximoIniB < TOL_ENDPOINT ||
            proximoFimB < TOL_ENDPOINT
          ) {
            continue
          }
          candidatos.push({
            posM: hit.x,
            dateMs: hit.y,
            a: tracos[i].tarefaId,
            b: tracos[j].tarefaId
          })
        }
      }
    }
  }

  // Filtro 3: deduplicação por vizinhança (cluster ± 500m × ± 1 dia)
  const TOL_POS = 500
  const TOL_TEMPO = DAY
  const out: ConflitoEspaco[] = []
  for (const c of candidatos) {
    const jaTem = out.find(
      (o) =>
        ((o.a === c.a && o.b === c.b) || (o.a === c.b && o.b === c.a)) &&
        Math.abs(o.posM - c.posM) <= TOL_POS &&
        Math.abs(o.dateMs - c.dateMs) <= TOL_TEMPO
    )
    if (!jaTem) out.push(c)
  }
  return out
}

// ─── Fim-de-semana / feriado bands ─────────────────────────────────────────

export interface BandaNaoTrabalhada {
  inicio: number
  fim: number
  fer: boolean
}

/** Gera bandas no domínio de tempo. Funde dias contíguos do mesmo tipo. */
export function bandasNaoTrabalhadas(t0: number, t1: number): BandaNaoTrabalhada[] {
  const out: BandaNaoTrabalhada[] = []
  let d = meiaNoite(t0)
  while (d <= t1) {
    const w = new Date(d).getDay()
    const fer = ehFeriado(d)
    if (w === 6 || w === 0 || fer) {
      out.push({
        inicio: Math.max(d, t0),
        fim: Math.min(d + DAY, t1),
        fer
      })
    }
    d += DAY
  }
  const merged: BandaNaoTrabalhada[] = []
  for (const b of out) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.fim - b.inicio) < 1 && last.fer === b.fer) {
      last.fim = b.fim
    } else {
      merged.push({ ...b })
    }
  }
  return merged
}

// ─── Meses no eixo Y (com flag de zebra) ───────────────────────────────────

export interface MesGrid {
  ms: number
  msReal: number
  fim: number
  nome: string
  zebra: number
}

const MES_CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

export function gerarMesesGrid(t0: number, t1: number): MesGrid[] {
  const out: MesGrid[] = []
  const d0 = new Date(t0)
  let cur = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime()
  while (cur <= t1) {
    const next = new Date(
      new Date(cur).getFullYear(),
      new Date(cur).getMonth() + 1,
      1
    ).getTime()
    if (next > t0) {
      out.push({
        ms: Math.max(cur, t0),
        msReal: cur,
        fim: Math.min(next, t1),
        nome: MES_CURTO[new Date(cur).getMonth()],
        zebra: new Date(cur).getMonth() % 2
      })
    }
    cur = next
  }
  return out
}
