/**
 * Importar a planilha de quantidades por local (o Quantity Import do DynaRoad), em 3 passos:
 *   1. arquivo — abas lidas (por ponto, por faixa, áreas) e erros com aba e célula;
 *   2. mapeamento — abas → locais (existente, criar eixo/área, não importar) e colunas → serviços do orçamento
 *      (código, descrição ou o mapeamento salvo da obra);
 *   3. prévia — importado × atual no template × orçamento, por local e serviço; gravar = nova versão por local.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, FileSpreadsheet, Save, Upload } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { pickFile } from '@/lib/files/pick-file'
import { loadWorkbookFromFile } from '@/lib/xlsx/download'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  type TrechoCtx
} from '@/lib/format/posicao'
import {
  converterAba,
  converterArea,
  estacaParaMetros,
  lerPlanilhaQuantidades,
  mapeamentoDaPlanilha,
  normalizarTexto,
  type AbaBoq,
  type ErroBoq,
  type LeituraBoq,
  type LinhaArea
} from '@/lib/quantidades/boq-xlsx'
import type { TrechoUnidadeConfig } from '@/lib/quantidades/grade'
import { fundirSegmentos, totaisPorItem, type SegmentoValores } from '@/lib/quantidades/segmentos'
import type { ObraTrecho, UnidadeEspacoPadrao } from '@/types/gerencial'
import {
  useCreateTrecho,
  useObraTrechos,
  useTrechosQuantidadeTemplatesAtuais,
  useUpdateTrecho
} from '../hooks/trechos'
import {
  useAgrupadoresTrecho,
  useMapeamentoQuantidades,
  useSalvarMapeamentoQuantidades,
  useSalvarQuantidadesTrecho,
  type AgrupadorTrecho
} from '../hooks/quantidades'
import { useCadeiaTrava } from '../hooks/planejamentos'
import {
  cfgUnidade,
  comprimentoEfetivo,
  ctxObraTrecho,
  normalizarNome,
  segmentosDoTemplate
} from '../lib/trecho'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** aberto a partir de um local: uma planilha de aba única vai para ele */
  localInicial?: ObraTrecho | null
  onConcluido?: (r: { trechoIds: string[]; itemIds: string[] }) => void
}

type Destino =
  | { modo: 'existente'; trechoId: string }
  | { modo: 'criar'; unidade: UnidadeEspacoPadrao }
  | { modo: 'nao' }

interface Arquivo {
  nome: string
  leitura: LeituraBoq
  /** cabeçalho normalizado → serviço, gravado na aba oculta das planilhas exportadas pelo sistema */
  oculto: Map<string, string>
}
interface LocalLido {
  chave: string
  nome: string
  tipo: 'eixo' | 'area'
  aba: AbaBoq
  linha?: LinhaArea
}
interface ColunaUnica {
  chave: string
  titulo: string
  unidade: string | null
  abas: string[]
}
interface LinhaPrevia {
  itemId: string
  codigo: string
  descricao: string
  unidade: string
  importado: number
  atual: number
  outros: number
  orcamento: number
  excede: boolean
}
interface PlanoLocal {
  local: LocalLido
  destino: Destino
  trecho: ObraTrecho | null
  novo: {
    unidade: UnidadeEspacoPadrao
    marcador_valor_inicial: number
    comprimento_m: number
  } | null
  erros: ErroBoq[]
  precisaEstender: number | null
  finais: SegmentoValores[]
  servicos: string[]
  itens: Set<string>
  linhas: LinhaPrevia[]
  faixaTexto: string
}

const UNIDADES: { v: UnidadeEspacoPadrao; t: string }[] = [
  { v: 'km', t: 'Quilômetro (km)' },
  { v: 'estaca', t: 'Estaca (20 m)' },
  { v: 'm', t: 'Metro (m)' }
]

const CABECALHO =
  'border-b border-border bg-bg-elevated text-left text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const PASSOS = ['Arquivo', 'Locais e serviços', 'Prévia'] as const

function unidadeSugerida(aba: AbaBoq): UnidadeEspacoPadrao {
  const vals =
    aba.layout === 'ponto'
      ? aba.pontos.map((p) => p.estaca)
      : aba.faixas.flatMap((f) => [f.ini, f.fim])
  if (vals.some((v) => typeof v === 'string' && /est/i.test(v))) return 'estaca'
  if (aba.emMetros) return 'm'
  if (vals.some((v) => typeof v === 'string' && v.includes('+'))) return 'km'
  const nums = vals.filter((v): v is number => typeof v === 'number')
  const max = nums.length ? Math.max(...nums) : 0
  return max > 500 ? 'm' : 'km'
}

function sugerirServico(
  chave: string,
  oculto: Map<string, string>,
  salvo: Map<string, string | null>,
  agrupadores: AgrupadorTrecho[]
): string | null | undefined {
  if (oculto.has(chave)) return oculto.get(chave)
  if (salvo.has(chave)) return salvo.get(chave)
  for (const a of agrupadores) {
    const cod = normalizarTexto(a.codigo)
    if (cod && (chave === cod || chave.startsWith(cod + ' ') || chave.startsWith(cod + '-')))
      return a.id
  }
  for (const a of agrupadores) {
    const d = normalizarTexto(a.descricao)
    if (d.length >= 4 && (chave === d || chave.includes(d) || d.includes(chave))) return a.id
  }
  return undefined
}

export function ImportarQuantidadesDialog({
  open,
  onOpenChange,
  obraId,
  localInicial,
  onConcluido
}: Props): ReactNode {
  const { data: trechos = [] } = useObraTrechos(obraId)
  const { data: agrupadores = [] } = useAgrupadoresTrecho(obraId)
  const { data: mapeamentoSalvo } = useMapeamentoQuantidades(obraId)
  const { data: trava } = useCadeiaTrava(obraId)
  const criarTrecho = useCreateTrecho()
  const atualizarTrecho = useUpdateTrecho()
  const salvarQtd = useSalvarQuantidadesTrecho()
  const salvarMapa = useSalvarMapeamentoQuantidades()

  const [passo, setPasso] = useState<1 | 2 | 3>(1)
  const [arquivo, setArquivo] = useState<Arquivo | null>(null)
  const [destLocais, setDestLocais] = useState<Record<string, Destino>>({})
  const [destCols, setDestCols] = useState<Record<string, string | null | undefined>>({})
  const [estender, setEstender] = useState<Record<string, boolean>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [gravando, setGravando] = useState(false)

  const locaisLidos: LocalLido[] = useMemo(() => {
    if (!arquivo) return []
    const out: LocalLido[] = []
    for (const aba of arquivo.leitura.abas) {
      if (aba.layout === 'areas')
        for (const l of aba.areas)
          out.push({
            chave: `area:${aba.nome}:${l.linha}`,
            nome: l.nome,
            tipo: 'area',
            aba,
            linha: l
          })
      else out.push({ chave: `aba:${aba.nome}`, nome: aba.nome, tipo: 'eixo', aba })
    }
    return out
  }, [arquivo])

  const colunasUnicas: ColunaUnica[] = useMemo(() => {
    const m = new Map<string, ColunaUnica>()
    for (const aba of arquivo?.leitura.abas ?? [])
      for (const k of aba.colunas) {
        const chave = normalizarTexto(k.titulo)
        const cur = m.get(chave)
        if (cur) cur.abas.push(aba.nome)
        else m.set(chave, { chave, titulo: k.titulo, unidade: k.unidade, abas: [aba.nome] })
      }
    return [...m.values()]
  }, [arquivo])

  const idsExistentes = useMemo(
    () => Object.values(destLocais).flatMap((d) => (d.modo === 'existente' ? [d.trechoId] : [])),
    [destLocais]
  )
  const templates = useTrechosQuantidadeTemplatesAtuais(idsExistentes)

  const reiniciar = (): void => {
    setPasso(1)
    setArquivo(null)
    setDestLocais({})
    setDestCols({})
    setEstender({})
    setErro(null)
  }
  const fechar = (o: boolean): void => {
    if (gravando) return
    if (!o) reiniciar()
    onOpenChange(o)
  }

  const escolherArquivo = async (): Promise<void> => {
    const file = await pickFile({ accept: '.xlsx,.xlsm' })
    if (!file) return
    setErro(null)
    try {
      const wb = await loadWorkbookFromFile(file)
      const leitura = lerPlanilhaQuantidades(wb)
      const oculto = mapeamentoDaPlanilha(wb)
      const arq = { nome: file.name, leitura, oculto }
      setArquivo(arq)
      // padrões: abas → locais pelo nome; colunas → serviços pelo mapeamento salvo, código ou descrição
      const eixosNaPlanilha = leitura.abas.filter((a) => a.layout !== 'areas')
      const dl: Record<string, Destino> = {}
      for (const aba of leitura.abas) {
        if (aba.layout === 'areas') {
          for (const l of aba.areas) {
            const ex = trechos.find(
              (t) => t.tipo === 'area' && normalizarNome(t.nome) === normalizarNome(l.nome)
            )
            dl[`area:${aba.nome}:${l.linha}`] = ex
              ? { modo: 'existente', trechoId: ex.id }
              : { modo: 'criar', unidade: 'm' }
          }
          continue
        }
        const ex = trechos.find(
          (t) => t.tipo === 'eixo' && normalizarNome(t.nome) === normalizarNome(aba.nome)
        )
        dl[`aba:${aba.nome}`] = ex
          ? { modo: 'existente', trechoId: ex.id }
          : localInicial?.tipo === 'eixo' && eixosNaPlanilha.length === 1
            ? { modo: 'existente', trechoId: localInicial.id }
            : { modo: 'criar', unidade: unidadeSugerida(aba) }
      }
      setDestLocais(dl)
      const dc: Record<string, string | null | undefined> = {}
      const vistas = new Set<string>()
      for (const aba of leitura.abas)
        for (const k of aba.colunas) {
          const chave = normalizarTexto(k.titulo)
          if (vistas.has(chave)) continue
          vistas.add(chave)
          dc[chave] = sugerirServico(chave, oculto, mapeamentoSalvo ?? new Map(), agrupadores)
        }
      setDestCols(dc)
      setEstender({})
    } catch (e) {
      setErro(`Não foi possível ler a planilha. ${(e as Error).message}`)
    }
  }

  // ── plano de importação (passo 3) ────────────────────────────────────────────────────────────────────────────
  const planos: PlanoLocal[] = useMemo(() => {
    const agr = new Map(agrupadores.map((a) => [a.id, a]))
    return locaisLidos.map((l): PlanoLocal => {
      const destino = destLocais[l.chave] ?? { modo: 'nao' }
      const mapaCol = new Map<number, string>()
      for (const k of l.aba.colunas) {
        const id = destCols[normalizarTexto(k.titulo)]
        if (typeof id === 'string') mapaCol.set(k.col, id)
      }
      const itens = new Set(mapaCol.values())
      const vazio: PlanoLocal = {
        local: l,
        destino,
        trecho: null,
        novo: null,
        erros: [],
        precisaEstender: null,
        finais: [],
        servicos: [],
        itens,
        linhas: [],
        faixaTexto: '—'
      }
      if (destino.modo === 'nao' || itens.size === 0) return vazio
      const trecho =
        destino.modo === 'existente'
          ? (trechos.find((t) => t.id === destino.trechoId) ?? null)
          : null
      const tpl = trecho ? (templates.get(trecho.id) ?? null) : null
      const existentes = segmentosDoTemplate(tpl)
      const totaisExist = totaisPorItem(existentes)
      const servicos = [
        ...new Set([...(tpl?.colunas.map((c) => c.item_orcamentario_id) ?? []), ...itens])
      ]
      const linhasDe = (totImp: Record<string, number>): LinhaPrevia[] =>
        [...itens].map((id) => {
          const a = agr.get(id)
          const atual = totaisExist[id] ?? 0
          const outros = Math.max(0, (a?.totalTrechos ?? 0) - atual)
          const importado = totImp[id] ?? 0
          return {
            itemId: id,
            codigo: a?.codigo ?? '?',
            descricao: a?.descricao ?? '',
            unidade: a?.unidade ?? '',
            importado,
            atual,
            outros,
            orcamento: a?.quantidade ?? 0,
            excede: outros + importado > (a?.quantidade ?? 0) + 0.0005
          }
        })

      if (l.tipo === 'area') {
        const seg = converterArea(l.linha!, mapaCol)
        const base = existentes[0]?.valores ?? {}
        const finais = [
          {
            ...seg,
            valores: {
              ...Object.fromEntries(Object.entries(base).filter(([id]) => !itens.has(id))),
              ...seg.valores
            }
          }
        ]
        return {
          ...vazio,
          trecho,
          finais,
          servicos,
          linhas: linhasDe(seg.valores),
          faixaTexto: 'Área inteira'
        }
      }

      let ctx: TrechoCtx
      let cfg: TrechoUnidadeConfig
      let comp: number
      let novo: PlanoLocal['novo'] = null
      if (trecho) {
        ctx = ctxObraTrecho(trecho)
        cfg = cfgUnidade(trecho)
        comp = comprimentoEfetivo(trecho)
      } else {
        const unidade = destino.modo === 'criar' ? destino.unidade : 'km'
        const ctx0: TrechoCtx = {
          unidade_espaco_padrao: unidade,
          marcador_valor_inicial: 0,
          geometry_sentido: 'natural',
          unidade_custom_divisor_m: null
        }
        const div = divisorMetrosPorUnidade(ctx0)
        const brutos =
          l.aba.layout === 'ponto'
            ? l.aba.pontos.map((p) => p.estaca)
            : l.aba.faixas.flatMap((f) => [f.ini, f.fim])
        const ms = brutos
          .map((v) => (l.aba.emMetros && typeof v === 'number' ? v : estacaParaMetros(v, ctx0)))
          .filter((m): m is number => m !== null)
        let m0 = ms.length ? Math.min(...ms) : 0
        let m1 = ms.length ? Math.max(...ms) : 0
        if (l.aba.emMetros) m0 = 0
        if (m1 <= m0 + 1e-6) m1 = m0 + div
        const inicial = Math.round((m0 / div) * 1000) / 1000
        comp = Math.round((m1 - m0) * 1000) / 1000
        ctx = { ...ctx0, marcador_valor_inicial: inicial, geometry_comprimento_m: comp }
        cfg = {
          geometry_comprimento_m: comp,
          unidade_espaco_padrao: unidade,
          unidade_custom_label: null,
          unidade_custom_divisor_m: null,
          marcador_valor_inicial: inicial,
          geometry_sentido: 'natural'
        }
        novo = { unidade, marcador_valor_inicial: inicial, comprimento_m: comp }
      }
      const podeEstender = !!trecho && !!estender[l.chave]
      const conv = converterAba(
        l.aba,
        ctx,
        { geometry_comprimento_m: podeEstender ? 0 : comp },
        mapaCol,
        divisorMetrosPorUnidade(ctx)
      )
      const precisaEstender =
        trecho && conv.maxM !== null && conv.maxM > comp + 0.005
          ? Math.ceil(conv.maxM * 100) / 100
          : null
      const cfgFinal =
        precisaEstender && podeEstender ? { ...cfg, geometry_comprimento_m: precisaEstender } : cfg
      const finais = conv.erros.length
        ? []
        : fundirSegmentos(cfgFinal, existentes, conv.segmentos, itens)
      return {
        ...vazio,
        trecho,
        novo,
        erros: conv.erros,
        precisaEstender,
        finais,
        servicos,
        linhas: linhasDe(conv.totais),
        faixaTexto:
          conv.minM !== null && conv.maxM !== null
            ? `De ${formatMarcadorCompacto(conv.minM, ctx)} a ${formatMarcadorCompacto(conv.maxM, ctx)}, ${formatNumber(conv.maxM - conv.minM, 0)} m`
            : '—'
      }
    })
  }, [locaisLidos, destLocais, destCols, trechos, templates, agrupadores, estender])

  const ativos = planos.filter((p) => p.destino.modo !== 'nao' && p.itens.size > 0)
  // Σ por serviço somando todos os locais desta importação (a prévia por local só vê "outros" já gravados)
  const excedeGlobal = useMemo(() => {
    const porItem = new Map<string, { soma: number; orcamento: number; codigo: string }>()
    for (const a of agrupadores)
      porItem.set(a.id, { soma: a.totalTrechos, orcamento: a.quantidade, codigo: a.codigo })
    for (const p of ativos)
      for (const ln of p.linhas) {
        const x = porItem.get(ln.itemId)
        if (x) x.soma += ln.importado - ln.atual
      }
    return [...porItem.values()].filter((x) => x.soma > x.orcamento + 0.0005)
  }, [agrupadores, ativos])
  const bloqueios = [
    ...ativos
      .filter((p) => p.erros.length > 0)
      .map((p) => `${p.local.nome}: corrija na planilha os erros listados acima e envie de novo.`),
    ...excedeGlobal.map(
      (x) =>
        `${x.codigo}: a soma nos locais (${formatNumber(x.soma, 3)}) passa do orçado (${formatNumber(x.orcamento, 3)}).`
    )
  ]

  const gravar = async (): Promise<void> => {
    if (bloqueios.length) return
    setErro(null)
    setGravando(true)
    const feitos: string[] = []
    const trechoIds: string[] = []
    const itemIds = new Set<string>()
    let ordem = trechos.length ? Math.max(...trechos.map((t) => t.ordem)) + 1 : 0
    try {
      for (const p of ativos) {
        let trechoId: string
        if (p.destino.modo === 'criar') {
          const r = await criarTrecho.mutateAsync({
            obra_id: obraId,
            nome: p.local.nome,
            ordem: ordem++,
            tipo: p.local.tipo,
            unidade_espaco_padrao: p.local.tipo === 'eixo' ? p.novo!.unidade : 'm',
            comprimento_m: p.local.tipo === 'eixo' ? p.novo!.comprimento_m : null,
            marcador_valor_inicial: p.local.tipo === 'eixo' ? p.novo!.marcador_valor_inicial : 0,
            geometry_sentido: 'natural'
          })
          trechoId = r.id
        } else {
          trechoId = (p.destino as { trechoId: string }).trechoId
          if (p.precisaEstender && estender[p.local.chave])
            await atualizarTrecho.mutateAsync({
              id: trechoId,
              obra_id: obraId,
              comprimento_m: p.precisaEstender
            })
        }
        await salvarQtd.mutateAsync({
          trecho_id: trechoId,
          modo: 'simplificado',
          servicos: p.servicos,
          segmentos: p.finais,
          nova_versao: true,
          comentario: `Importado de ${arquivo?.nome ?? 'planilha'}`
        })
        feitos.push(p.local.nome)
        trechoIds.push(trechoId)
        p.itens.forEach((id) => itemIds.add(id))
      }
      await salvarMapa.mutateAsync({
        obra_id: obraId,
        itens: colunasUnicas
          .filter((c) => destCols[c.chave] !== undefined)
          .map((c) => ({ chave: c.chave, item_orcamentario_id: destCols[c.chave] ?? null }))
      })
      toast.success(
        `Quantidades importadas em ${contar(feitos.length, 'local', 'locais')}: ${feitos.join(', ')}. As tarefas “do template” foram recalculadas.`
      )
      onConcluido?.({ trechoIds, itemIds: [...itemIds] })
      reiniciar()
      onOpenChange(false)
    } catch (e) {
      setErro(
        `Não foi possível concluir a importação. ${(e as Error).message}${feitos.length ? ` Já foram importados: ${feitos.join(', ')}.` : ''}`
      )
    } finally {
      setGravando(false)
    }
  }

  const leitura = arquivo?.leitura
  const podeAvancar1 = !!leitura && leitura.abas.length > 0 && leitura.erros.length === 0
  const podeAvancar2 =
    ativos.length > 0 && colunasUnicas.some((c) => typeof destCols[c.chave] === 'string')
  const eixos = trechos.filter((t) => t.tipo === 'eixo')
  const areas = trechos.filter((t) => t.tipo === 'area')
  const motivoNaoAvanca =
    passo === 1 && !podeAvancar1
      ? !leitura
        ? 'Escolha a planilha para continuar.'
        : leitura.erros.length > 0
          ? 'Corrija os erros na planilha e escolha o arquivo de novo.'
          : 'A planilha não tem aba com quantidades.'
      : passo === 2 && !podeAvancar2
        ? 'Para continuar, importe ao menos um local e ligue ao menos uma coluna a um serviço.'
        : null
  const motivoNaoImporta = trava
    ? `Somente leitura: ${trava}.`
    : ativos.length === 0
      ? 'Nada para importar com essa escolha.'
      : bloqueios.length > 0
        ? 'Resolva os problemas listados na prévia.'
        : null

  return (
    <Dialog open={open} onOpenChange={fechar} size="xl" disableDismiss={gravando}>
      <DialogHeader>
        <DialogTitle>Importar quantidades por local</DialogTitle>
        <DialogDescription>
          Uma aba por local: por estaca (coluna “Estaca” e uma coluna por serviço), por faixa
          (colunas “Início” e “Fim”) ou a aba “Áreas”. A quantidade de uma estaca vale até o meio do
          caminho para as vizinhas; zero fecha a sequência.
        </DialogDescription>
        <ol className="mt-2 flex flex-wrap gap-1 text-xs" aria-label="Passos da importação">
          {PASSOS.map((t, i) => (
            <li
              key={t}
              aria-current={passo === i + 1 ? 'step' : undefined}
              className={`rounded border px-2 py-0.5 ${passo === i + 1 ? 'border-accent bg-accent-glow font-medium text-text' : 'border-border text-text-muted'}`}
            >
              {i + 1}. {t}
            </li>
          ))}
        </ol>
      </DialogHeader>
      <DialogBody className="space-y-3 max-h-[62vh] overflow-auto">
        <DialogErrorBanner message={erro} />
        {trava ? (
          <div
            role="status"
            className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text"
          >
            Somente leitura: {trava}.
          </div>
        ) : null}

        {passo === 1 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => void escolherArquivo()} disabled={!!trava}>
                <Upload size={12} /> {arquivo ? 'Escolher outra planilha' : 'Escolher planilha'}
              </Button>
              {arquivo ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
                  <FileSpreadsheet size={14} aria-hidden /> {arquivo.nome}
                </span>
              ) : null}
            </div>
            {leitura ? (
              <>
                <p className="text-sm text-text" role="status">
                  <span className="font-semibold">
                    {contar(leitura.abas.length, 'aba lida', 'abas lidas')}
                  </span>
                  {leitura.erros.length > 0
                    ? `, ${contar(leitura.erros.length, 'erro', 'erros')}`
                    : ', sem erros'}
                  .
                </p>
                <div className="overflow-x-auto rounded border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={CABECALHO}>
                        <th className="px-2 py-1.5">Aba</th>
                        <th className="px-2 py-1.5">Formato</th>
                        <th className="px-2 py-1.5 text-right">Linhas</th>
                        <th className="px-2 py-1.5">Colunas de serviço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leitura.abas.map((a) => (
                        <tr key={a.nome} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-1 font-medium text-text">{a.nome}</td>
                          <td className="px-2 py-1">
                            <Badge variant="outline">
                              {a.layout === 'ponto'
                                ? 'Por estaca'
                                : a.layout === 'faixa'
                                  ? 'Por faixa'
                                  : 'Áreas'}
                            </Badge>
                          </td>
                          <td className="tabular px-2 py-1 text-right">
                            {a.layout === 'ponto'
                              ? a.pontos.length
                              : a.layout === 'faixa'
                                ? a.faixas.length
                                : a.areas.length}
                          </td>
                          <td
                            className="max-w-[420px] truncate px-2 py-1 text-text-muted"
                            title={a.colunas.map((k) => k.titulo).join(' · ')}
                          >
                            {a.colunas.map((k) => k.titulo).join(' · ')}
                          </td>
                        </tr>
                      ))}
                      {leitura.abas.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-text-muted">
                            Nenhuma aba tem tabela de quantidades. O cabeçalho precisa ter “Estaca”,
                            “Início” e “Fim”, ou “Área”.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {leitura.ignoradas.length ? (
                  <p className="text-sm text-text-muted">
                    Abas ignoradas, por não terem tabela: {leitura.ignoradas.join(', ')}.
                  </p>
                ) : null}
                {leitura.erros.length ? <ListaErros erros={leitura.erros} /> : null}
              </>
            ) : (
              <p className="text-sm text-text-muted">
                Em Locais, “Exportar planilha” gera o modelo com os serviços do orçamento e os
                locais atuais: preencha e importe de volta. Planilha do DynaRoad (uma aba por local,
                coluna “Station”) também é aceita.
              </p>
            )}
          </div>
        ) : null}

        {passo === 2 && arquivo ? (
          <div className="space-y-4">
            <section className="space-y-1.5">
              <h3 className="text-md font-semibold text-text">Abas da planilha e locais</h3>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={CABECALHO}>
                      <th className="px-2 py-1.5">Na planilha</th>
                      <th className="w-[300px] px-2 py-1.5">Local no InfraWork</th>
                      <th className="w-[170px] px-2 py-1.5">Unidade do novo eixo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locaisLidos.map((l) => {
                      const d = destLocais[l.chave] ?? { modo: 'nao' as const }
                      const valor =
                        d.modo === 'existente'
                          ? `ex:${d.trechoId}`
                          : d.modo === 'criar'
                            ? 'criar'
                            : 'nao'
                      const opcoes = l.tipo === 'eixo' ? eixos : areas
                      return (
                        <tr key={l.chave} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-1">
                            <span className="font-medium text-text">{l.nome}</span>{' '}
                            <Badge variant="outline" className="ml-1">
                              {l.tipo === 'eixo'
                                ? l.aba.layout === 'ponto'
                                  ? 'Por estaca'
                                  : 'Por faixa'
                                : 'Área'}
                            </Badge>
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={valor}
                              aria-label={`Local para ${l.nome}`}
                              onChange={(e) => {
                                const v = e.target.value
                                setDestLocais((s) => ({
                                  ...s,
                                  [l.chave]: v.startsWith('ex:')
                                    ? { modo: 'existente', trechoId: v.slice(3) }
                                    : v === 'criar'
                                      ? {
                                          modo: 'criar',
                                          unidade:
                                            d.modo === 'criar'
                                              ? d.unidade
                                              : l.tipo === 'eixo'
                                                ? unidadeSugerida(l.aba)
                                                : 'm'
                                        }
                                      : { modo: 'nao' }
                                }))
                              }}
                            >
                              <option value="criar">
                                {l.tipo === 'eixo'
                                  ? `Criar o eixo “${l.nome}”`
                                  : `Criar a área “${l.nome}”`}
                              </option>
                              {opcoes.length ? (
                                <optgroup
                                  label={
                                    l.tipo === 'eixo' ? 'Eixos existentes' : 'Áreas existentes'
                                  }
                                >
                                  {opcoes.map((t) => (
                                    <option key={t.id} value={`ex:${t.id}`}>
                                      {t.nome}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              <option value="nao">Não importar</option>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            {d.modo === 'criar' && l.tipo === 'eixo' ? (
                              <Select
                                value={d.unidade}
                                aria-label={`Unidade do novo eixo ${l.nome}`}
                                onChange={(e) =>
                                  setDestLocais((s) => ({
                                    ...s,
                                    [l.chave]: {
                                      modo: 'criar',
                                      unidade: e.target.value as UnidadeEspacoPadrao
                                    }
                                  }))
                                }
                              >
                                {UNIDADES.map((u) => (
                                  <option key={u.v} value={u.v}>
                                    {u.t}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="text-text-dim">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="space-y-1.5">
              <h3 className="text-md font-semibold text-text">Colunas e serviços do orçamento</h3>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={CABECALHO}>
                      <th className="px-2 py-1.5">Coluna na planilha</th>
                      <th className="w-24 px-2 py-1.5">Unidade</th>
                      <th className="w-[360px] px-2 py-1.5">Serviço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colunasUnicas.map((c) => {
                      const id = destCols[c.chave]
                      const a = typeof id === 'string' ? agrupadores.find((x) => x.id === id) : null
                      const unidadeDifere =
                        a && c.unidade && normalizarTexto(a.unidade) !== normalizarTexto(c.unidade)
                      return (
                        <tr key={c.chave} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-1">
                            <span className="text-text">{c.titulo}</span>
                            {c.abas.length > 1 ? (
                              <span className="ml-1 text-xs text-text-muted">
                                em {c.abas.length} abas
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-text-muted">{c.unidade ?? '—'}</td>
                          <td className="px-2 py-1">
                            <Select
                              value={id === undefined ? '' : (id ?? 'nao')}
                              aria-label={`Serviço para a coluna ${c.titulo}`}
                              className={id === undefined ? 'border-warn' : undefined}
                              onChange={(e) =>
                                setDestCols((s) => ({
                                  ...s,
                                  [c.chave]: e.target.value === 'nao' ? null : e.target.value
                                }))
                              }
                            >
                              <option value="" disabled>
                                Selecione…
                              </option>
                              {agrupadores.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.codigo} {g.descricao} ({g.unidade})
                                </option>
                              ))}
                              <option value="nao">Não importar</option>
                            </Select>
                            {id === undefined ? (
                              <div className="mt-0.5 text-xs text-text-muted">
                                Sem serviço escolhido: a coluna não é importada.
                              </div>
                            ) : null}
                            {unidadeDifere ? (
                              <div className="mt-0.5 text-xs font-medium text-text">
                                Atenção: a unidade da planilha ({c.unidade}) é diferente da do
                                serviço ({a!.unidade}).
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-text-muted">
                Essa ligação entre colunas e serviços fica salva na obra e é reaproveitada na
                próxima importação.
              </p>
            </section>
          </div>
        ) : null}

        {passo === 3 ? (
          <div className="space-y-3">
            {ativos.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nada para importar com essa escolha. Volte e importe ao menos um local, com ao menos
                uma coluna ligada a um serviço.
              </p>
            ) : (
              <p className="text-sm text-text" role="status">
                <span className="font-semibold">
                  {contar(ativos.length, 'local', 'locais')} para importar
                </span>
                {bloqueios.length > 0
                  ? `, ${contar(bloqueios.length, 'problema', 'problemas')} para resolver antes`
                  : '. Cada local ganha uma nova versão das quantidades.'}
              </p>
            )}
            {ativos.map((p) => (
              <section key={p.local.chave} className="rounded border border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-elevated px-3 py-1.5 text-sm">
                  <span className="font-medium text-text">{p.local.nome}</span>
                  <Badge variant="outline">{p.local.tipo === 'eixo' ? 'Eixo' : 'Área'}</Badge>
                  <span className="text-text-muted">
                    vai para{' '}
                    {p.destino.modo === 'criar'
                      ? p.local.tipo === 'eixo'
                        ? `um novo eixo${p.novo ? ` (${UNIDADES.find((u) => u.v === p.novo!.unidade)?.t ?? p.novo.unidade}, ${formatNumber(p.novo.comprimento_m, 0)} m)` : ''}`
                        : 'uma nova área'
                      : `${p.trecho?.nome ?? '?'}${p.trecho?.tipo === 'eixo' ? ` (${formatNumber(comprimentoEfetivo(p.trecho), 0)} m)` : ''}`}
                  </span>
                  <span className="tabular ml-auto text-text-muted">{p.faixaTexto}</span>
                </div>
                {p.precisaEstender ? (
                  <label className="flex cursor-pointer items-start gap-2 border-b border-border bg-warn/10 px-3 py-1.5 text-sm text-text">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      checked={!!estender[p.local.chave]}
                      onChange={(e) =>
                        setEstender((s) => ({ ...s, [p.local.chave]: e.target.checked }))
                      }
                    />
                    <span>
                      A planilha vai até {formatNumber(p.precisaEstender, 0)} m e o eixo tem{' '}
                      {formatNumber(comprimentoEfetivo(p.trecho!), 0)} m. Aumentar o eixo até{' '}
                      {formatNumber(p.precisaEstender, 0)} m ao importar.
                    </span>
                  </label>
                ) : null}
                {p.erros.length ? (
                  <div className="px-3 py-1.5 border-b border-border">
                    <ListaErros erros={p.erros} />
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={CABECALHO}>
                        <th className="px-3 py-1.5">Serviço</th>
                        <th className="px-2 py-1.5 text-right">Importado</th>
                        <th className="px-2 py-1.5 text-right">Atual no local</th>
                        <th className="px-2 py-1.5 text-right">Outros locais</th>
                        <th className="px-2 py-1.5 text-right">Orçado</th>
                        <th className="px-2 py-1.5">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {p.linhas.map((ln) => (
                        <tr key={ln.itemId} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-1">
                            <span className="mr-1 text-text-muted">{ln.codigo}</span>
                            {ln.descricao}
                            <span className="ml-1 text-text-muted">({ln.unidade})</span>
                          </td>
                          <td className="px-2 py-1 text-right text-text">
                            {formatNumber(ln.importado, 3)}
                          </td>
                          <td className="px-2 py-1 text-right text-text-muted">
                            {formatNumber(ln.atual, 3)}
                          </td>
                          <td className="px-2 py-1 text-right text-text-muted">
                            {formatNumber(ln.outros, 3)}
                          </td>
                          <td className="px-2 py-1 text-right text-text-muted">
                            {formatNumber(ln.orcamento, 3)}
                          </td>
                          <td className="px-2 py-1">
                            {ln.excede ? (
                              <Badge variant="danger">Acima do orçado</Badge>
                            ) : Math.abs(ln.importado - ln.atual) < 0.0005 ? (
                              <Badge variant="outline">Igual</Badge>
                            ) : ln.atual > 0 ? (
                              <Badge variant="warn">Substitui</Badge>
                            ) : (
                              <Badge variant="success">Novo</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {bloqueios.length ? (
              <div
                role="alert"
                className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                <ul className="list-disc space-y-0.5 pl-4">
                  {bloqueios.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {motivoNaoAvanca && (passo === 2 || (passo === 1 && leitura)) ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {motivoNaoAvanca}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => fechar(false)} disabled={gravando}>
          Cancelar
        </Button>
        {passo > 1 ? (
          <Button
            variant="secondary"
            onClick={() => setPasso((p) => (p === 3 ? 2 : 1))}
            disabled={gravando}
          >
            <ArrowLeft size={12} /> Voltar
          </Button>
        ) : null}
        {passo < 3 ? (
          <Button
            onClick={() => setPasso((p) => (p === 1 ? 2 : 3))}
            disabled={(passo === 1 && !podeAvancar1) || (passo === 2 && !podeAvancar2)}
            title={motivoNaoAvanca ?? undefined}
          >
            Continuar <ArrowRight size={12} />
          </Button>
        ) : (
          <Button
            onClick={() => void gravar()}
            disabled={gravando || !!trava || bloqueios.length > 0 || ativos.length === 0}
            title={motivoNaoImporta ?? undefined}
          >
            <Save size={12} />{' '}
            {gravando ? 'Importando…' : `Importar para ${contar(ativos.length, 'local', 'locais')}`}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function ListaErros({ erros }: { erros: ErroBoq[] }): ReactNode {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Erros da planilha"
      className="max-h-40 overflow-auto rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      <ul className="space-y-0.5">
        {erros.slice(0, 40).map((e, i) => (
          <li key={i}>
            <span className="font-medium">
              Aba {e.aba}
              {e.celula ? `, célula ${e.celula}` : ''}:
            </span>{' '}
            {e.mensagem}
          </li>
        ))}
        {erros.length > 40 ? <li>E mais {contar(erros.length - 40, 'erro', 'erros')}.</li> : null}
      </ul>
    </div>
  )
}
