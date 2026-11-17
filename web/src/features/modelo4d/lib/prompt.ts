import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  metrosToMarcador,
  type TrechoCtx
} from '@/lib/format/posicao'
import { CONTRATO_TEXTO } from './contrato-texto'
import type { TrechoPlano } from './estado'
import type { ResumoModelo } from './preparar'

export interface ServicoContexto {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
}

export interface LocalContexto extends TrechoCtx {
  id: string
  nome: string
  tipo: 'eixo' | 'area'
  comprimento_m: number | null
}

export interface ContextoObra {
  obra: string
  locais: LocalContexto[]
  servicos: ServicoContexto[]
  plano: TrechoPlano[]
}

const sem = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Pares (palavra da classe, palavra do serviço) que dizem que os dois falam da mesma coisa; o 3º é o que exclui. */
const AFINIDADES: [RegExp, RegExp, RegExp?][] = [
  // drenagem e obras antes da terraplenagem: "valeta de proteção de corte" é valeta, não escavação
  [/meio-?fio|\bmfc\b/, /meio-?fio/],
  [/sarjeta|\bstc\b|\bszc\b/, /sarjeta/],
  [/valeta|\bvpcc\b|\bvpac\b/, /valeta/],
  [/dreno|\bdps\b/, /dreno|drenagem profunda/],
  [/descida/, /descida/],
  [/dissipador/, /dissipador/],
  [/bueiro/, /bueiro|buero|\bbstc\b|\bbdtc\b|\bbttc\b|\bbscc\b|\bbdcc\b/],
  [/cerca/, /cerca/],
  [/defensa/, /defensa/],
  [/sinalizacao horizontal/, /horizontal|pintura de faixa/, /provisoria/],
  [/sinalizacao vertical|placa/, /vertical|placa/, /provisoria/],
  [/regulariza/, /regulariza/],
  [/sub-?base/, /sub-?base/],
  [/\bbase\b/, /\bbase\b/, /sub-?base/],
  [/imprima/, /imprima/],
  [/tratamento superficial|\btsd\b/, /tratamento superficial|\btsd\b/],
  [/micro/, /micro/],
  [
    /cbuq|cauq|concreto betuminoso|concreto asfaltico/,
    /cbuq|cauq|concreto betuminoso|concreto asfaltico/
  ],
  [/pintura de liga/, /pintura de liga/],
  [/corte|escava/, /escav|corte/],
  [/aterro/, /aterro|compacta/]
]

/**
 * Sugere o serviço de cada classe: pelo código que o modelo traz ou, sem ele, pelo nome. Só sugere quando um único
 * serviço combina; na dúvida deixa sem vínculo para a pessoa escolher.
 */
export function sugerirVinculos(
  classes: ResumoModelo['classes'],
  servicos: ServicoContexto[]
): Record<string, string> {
  const out: Record<string, string> = {}
  const porCodigo = new Map(servicos.map((s) => [sem(s.codigo.trim()), s.id]))
  for (const c of classes) {
    if (c.contexto) continue
    const direto = c.servico ? porCodigo.get(sem(c.servico.trim())) : undefined
    if (direto) {
      out[c.id] = direto
      continue
    }
    const nome = sem(`${c.nome} ${c.id}`)
    for (const [naClasse, noServico, exceto] of AFINIDADES) {
      if (!naClasse.test(nome) || exceto?.test(nome)) continue
      const achados = servicos.filter((s) => {
        const d = sem(s.descricao)
        return noServico.test(d) && !exceto?.test(d)
      })
      if (achados.length === 1) out[c.id] = achados[0].id
      break
    }
  }
  return out
}

const num = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Estaqueamento, serviços e faixas do plano, em texto, para quem vai gerar o modelo. */
export function contextoDoPlano(c: ContextoObra): string {
  const linhas: string[] = [`## Obra: ${c.obra}`, '', '### Locais (eixos) da obra', '']
  const eixos = c.locais.filter((l) => l.tipo === 'eixo')
  if (!eixos.length) linhas.push('A obra ainda não tem local do tipo eixo cadastrado.')
  for (const l of eixos) {
    const d = divisorMetrosPorUnidade(l)
    const s0 = metrosToMarcador(0, l) * d
    const s1 = metrosToMarcador(l.comprimento_m ?? 0, l) * d
    linhas.push(
      `- **${l.nome}**: de ${formatMarcadorCompacto(0, l)} a ${formatMarcadorCompacto(l.comprimento_m ?? 0, l)}` +
        ` (${num(l.comprimento_m ?? 0)} m). No modelo, \`s\` vai de ${num(Math.min(s0, s1))} a ${num(Math.max(s0, s1))}.`
    )
  }
  linhas.push(
    '',
    '### Serviços do plano (linha de base)',
    '',
    'Use o código em `classes[].servico`. Uma classe por serviço.',
    '',
    '| Código | Serviço | Un. | Quantidade no plano | Onde (s em metros) |',
    '| --- | --- | --- | --- | --- |'
  )
  const locais = new Map(c.locais.map((l) => [l.id, l]))
  for (const s of c.servicos) {
    const wps = c.plano.filter((w) => w.item_id === s.id)
    const total = wps.reduce((t, w) => t + w.quantidade, 0)
    const faixas = new Set<string>()
    for (const w of wps) {
      const l = w.trecho_id ? locais.get(w.trecho_id) : undefined
      if (!l || w.inicio_m == null || w.fim_m == null) {
        faixas.add(l ? `${l.nome} inteiro` : 'sem local')
        continue
      }
      const d = divisorMetrosPorUnidade(l)
      const a = metrosToMarcador(w.inicio_m, l) * d
      const b = metrosToMarcador(w.fim_m, l) * d
      faixas.add(`${num(Math.min(a, b))} a ${num(Math.max(a, b))}`)
    }
    linhas.push(
      `| ${s.codigo} | ${s.descricao.replace(/\|/g, '/')} | ${s.unidade ?? ''} | ${wps.length ? num(total) : 'fora do plano'} | ${[...faixas].slice(0, 12).join('; ')}${faixas.size > 12 ? '…' : ''} |`
    )
  }
  return linhas.join('\n')
}

/** Prompt completo para gerar o modelo no Claude apontado para a pasta de projeto. */
export function montarPrompt(c: ContextoObra): string {
  return [
    'Gere o modelo 4D desta obra para o InfraWork a partir dos arquivos de projeto desta pasta (geométrico,',
    'notas de serviço, cubação, pavimentação, drenagem, obras de arte correntes, obras complementares e',
    'sinalização). O resultado é um único arquivo `modelo.iw4d.json` no contrato abaixo.',
    '',
    'Como trabalhar:',
    '',
    '1. Escreva um script (Python) que leia os arquivos de projeto e monte o JSON. Não digite coordenadas à mão.',
    '2. Use exatamente os códigos de serviço da tabela "Serviços do plano" em `classes[].servico`, uma classe',
    '   por serviço. O que não tem serviço no plano vai como classe de contexto ou fica de fora.',
    '3. Respeite o estaqueamento da obra: `s` em metros desde a estaca 0, nos limites informados para cada local.',
    '4. Confira antes de entregar: todo elemento tem classe existente, as estacas caem dentro do eixo e a soma',
    '   das quantidades de cada classe está próxima da quantidade do serviço no plano. Diga o que ficou de fora.',
    '',
    contextoDoPlano(c),
    '',
    CONTRATO_TEXTO
  ].join('\n')
}
