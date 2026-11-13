/**
 * Quantidades de um local (o BOQ por estaca do DynaRoad): grade editável na tela — linhas = faixas no passo
 * escolhido (unidade, N unidades, N metros ou faixas livres), colunas = serviços do orçamento marcados à esquerda.
 * Versionado; Σ dos locais por serviço ≤ orçamento; tarefas "do template" acompanham ao salvar.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Download, History, Plus, RotateCcw, Save, Upload } from 'lucide-react'
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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { downloadBlob, nomeComStamp } from '@/lib/files/download'
import { formatDate, formatNumber, parseNumero } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { gerarPlanilhaQuantidades } from '@/lib/quantidades/boq-xlsx'
import {
  divisorUnidade,
  gerarSegmentos,
  reamostrarSegmentos,
  rotuloPosicao,
  rotuloUnidade,
  type Passo,
  type SegmentoValores
} from '@/lib/quantidades/segmentos'
import type { ObraTrecho } from '@/types/gerencial'
import { useTrechoQuantidadeTemplateAtual } from '../hooks/trechos'
import {
  useAgrupadoresTrecho,
  useQuantidadesEmTarefas,
  useRestaurarVersaoTrecho,
  useSalvarQuantidadesTrecho,
  useVersoesTrecho
} from '../hooks/quantidades'
import { useCadeiaTrava, usePlanejamentoAtivo } from '../hooks/planejamentos'
import {
  cfgUnidade,
  comprimentoEfetivo,
  ctxObraTrecho,
  estacaFinalTexto,
  estacaInicialTexto,
  segmentosDoTemplate
} from '../lib/trecho'
import {
  GradeQuantidades,
  type ColunaGrade,
  type RodapeColuna
} from '../components/locais/GradeQuantidades'
import { ImportarQuantidadesDialog } from './ImportarQuantidadesDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trecho: ObraTrecho
  empresaNome?: string
  obraCodigo?: string
  obraNome: string
}

type PassoUI = 'unidade' | 'unidades' | 'metros' | 'livre'

const SEG_AREA: SegmentoValores = {
  ini: 0,
  fim: 1,
  label_ini: 'área',
  label_fim: 'área',
  valores: {}
}

export function QuantidadesTrechoDialog({
  open,
  onOpenChange,
  trecho,
  obraNome
}: Props): ReactNode {
  const q = useTrechoQuantidadeTemplateAtual(trecho.id)
  const atual = q.data ?? null
  const { data: agrupadores = [] } = useAgrupadoresTrecho(trecho.obra_id)
  const { data: versoes = [] } = useVersoesTrecho(trecho.id)
  const { data: trava } = useCadeiaTrava(trecho.obra_id)
  const { data: plano } = usePlanejamentoAtivo(trecho.obra_id)
  const { data: emTarefas = [] } = useQuantidadesEmTarefas(plano?.id)
  const salvar = useSalvarQuantidadesTrecho()
  const restaurar = useRestaurarVersaoTrecho()
  const confirm = useConfirm()

  const ehArea = trecho.tipo === 'area'
  const cfg = useMemo(() => cfgUnidade(trecho), [trecho])
  const ctx = useMemo(() => ctxObraTrecho(trecho), [trecho])
  const comp = comprimentoEfetivo(trecho)
  const editavel = !trava

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [segs, setSegs] = useState<SegmentoValores[]>([])
  const [passoTipo, setPassoTipo] = useState<PassoUI>('unidade')
  const [passoN, setPassoN] = useState('5')
  const [sujo, setSujo] = useState(false)
  const [novaVersao, setNovaVersao] = useState(true)
  const [comentario, setComentario] = useState('')
  const [verHistorico, setVerHistorico] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [importarOpen, setImportarOpen] = useState(false)

  // recarrega o rascunho quando a versão salva muda (salvar, importar, restaurar)
  const chave = `${atual?.id ?? 'novo'}:${q.dataUpdatedAt}`
  useEffect(() => {
    if (!open || q.isPending) return
    if (atual) {
      setSel(new Set(atual.colunas.map((c) => c.item_orcamentario_id)))
      setSegs(
        ehArea ? [{ ...SEG_AREA, ...segmentosDoTemplate(atual)[0] }] : segmentosDoTemplate(atual)
      )
      setPassoTipo(ehArea || atual.modo !== 'analitico' ? 'livre' : 'unidade')
    } else {
      setSel(new Set())
      setSegs(
        ehArea
          ? [SEG_AREA]
          : gerarSegmentos(cfg, { tipo: 'unidade' }).map((g) => ({
              ini: g.posicao_inicio_m,
              fim: g.posicao_fim_m,
              label_ini: g.unidade_inicio_label,
              label_fim: g.unidade_fim_label,
              valores: {}
            }))
      )
      setPassoTipo(ehArea ? 'livre' : 'unidade')
    }
    setSujo(false)
    setComentario('')
    setErro(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chave, q.isPending])

  const colunas: ColunaGrade[] = useMemo(
    () =>
      agrupadores
        .filter((a) => sel.has(a.id))
        .map((a) => ({ id: a.id, codigo: a.codigo, descricao: a.descricao, unidade: a.unidade })),
    [agrupadores, sel]
  )
  const totaisSalvos = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of segmentosDoTemplate(atual))
      for (const [id, v] of Object.entries(s.valores)) m.set(id, (m.get(id) ?? 0) + v)
    return m
  }, [atual])
  const rodape = useMemo(() => {
    const m = new Map<string, RodapeColuna>()
    for (const a of agrupadores) {
      const emT = emTarefas
        .filter((l) => l.trecho_id === trecho.id && l.item_orcamentario_id === a.id)
        .reduce((t, l) => t + l.quantidade, 0)
      m.set(a.id, {
        emTarefas: emT,
        outros: Math.max(0, a.totalTrechos - (totaisSalvos.get(a.id) ?? 0)),
        orcamento: a.quantidade
      })
    }
    return m
  }, [agrupadores, emTarefas, totaisSalvos, trecho.id])
  const totais = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of segs)
      for (const [id, v] of Object.entries(s.valores)) m.set(id, (m.get(id) ?? 0) + v)
    return m
  }, [segs])

  const mudar = (novo: SegmentoValores[]): void => {
    setSegs(novo)
    setSujo(true)
  }
  const aplicarPasso = (tipo: PassoUI, nTxt: string): void => {
    setPassoTipo(tipo)
    setPassoN(nTxt)
    if (ehArea || tipo === 'livre') return
    const n = Math.max(1, parseNumero(nTxt) ?? 1)
    const passo: Passo =
      tipo === 'unidade'
        ? { tipo: 'unidade' }
        : tipo === 'unidades'
          ? { tipo: 'unidades', n }
          : { tipo: 'metros', m: n }
    const grade = gerarSegmentos(cfg, passo)
    if (grade.length === 0) return
    mudar(reamostrarSegmentos(segs, grade))
  }
  const addFaixa = (): void => {
    const ult = segs[segs.length - 1]
    const ini = ult ? ult.fim : 0
    if (comp > 0 && ini >= comp - 0.005) {
      toast.info('O eixo já está coberto até o fim.')
      return
    }
    const fim = comp > 0 ? Math.min(ini + divisorUnidade(cfg), comp) : ini + divisorUnidade(cfg)
    mudar([
      ...segs,
      {
        ini,
        fim,
        label_ini: rotuloPosicao(ini, cfg),
        label_fim: rotuloPosicao(fim, cfg),
        valores: {}
      }
    ])
  }

  const validar = (): string | null => {
    if (sel.size === 0) return 'Marque ao menos um serviço do orçamento na lista à esquerda.'
    if (!ehArea) {
      const ord = [...segs].sort((a, b) => a.ini - b.ini)
      for (let i = 0; i < ord.length; i++) {
        const s = ord[i]!
        if (!(s.fim > s.ini)) return `A faixa ${i + 1} tem comprimento zero.`
        if (comp > 0 && s.fim > comp + 0.005)
          return `A faixa até ${formatNumber(s.fim, 0)} m passa do comprimento do eixo (${formatNumber(comp, 0)} m). Aumente o eixo em Locais.`
        if (i > 0 && s.ini < ord[i - 1]!.fim - 0.005)
          return 'Há faixas sobrepostas. Ajuste o início ou o fim delas.'
      }
    }
    const excede = colunas.filter((k) => {
      const r = rodape.get(k.id)
      return r ? (totais.get(k.id) ?? 0) + r.outros > r.orcamento + 0.0005 : false
    })
    if (excede.length)
      return `Somando os outros locais, a quantidade passa do orçado em: ${excede.map((k) => k.codigo).join(', ')}.`
    return null
  }

  const gravar = async (): Promise<void> => {
    const v = validar()
    if (v) {
      setErro(v)
      return
    }
    setErro(null)
    try {
      const ord = ehArea ? segs.slice(0, 1) : [...segs].sort((a, b) => a.ini - b.ini)
      const r = await salvar.mutateAsync({
        trecho_id: trecho.id,
        modo: !ehArea && passoTipo === 'unidade' ? 'analitico' : 'simplificado',
        servicos: [...sel],
        segmentos: ord.map((s) => ({
          ...s,
          valores: Object.fromEntries(Object.entries(s.valores).filter(([id]) => sel.has(id)))
        })),
        nova_versao: !atual || novaVersao,
        comentario
      })
      toast.success(
        `Quantidades salvas: ${contar(r.segmentos, 'faixa', 'faixas')} e ${contar(r.celulas, 'valor', 'valores')}. As tarefas "do template" foram recalculadas.`
      )
      setSujo(false)
    } catch (e) {
      setErro(`Não foi possível salvar as quantidades. ${(e as Error).message}`)
    }
  }

  const fechar = async (o: boolean): Promise<void> => {
    if (!o && sujo) {
      const ok = await confirm({
        title: 'Descartar alterações?',
        description: 'As quantidades editadas ainda não foram salvas.',
        confirmLabel: 'Descartar',
        variant: 'danger'
      })
      if (!ok) return
    }
    onOpenChange(o)
  }

  const exportar = async (): Promise<void> => {
    const blob = await gerarPlanilhaQuantidades({
      obraNome,
      servicos: colunas,
      locais: [{ nome: trecho.nome, tipo: trecho.tipo, segmentos: segs }]
    })
    downloadBlob(blob, nomeComStamp(`quantidades-${trecho.nome}`, 'xlsx'))
  }

  const rot = rotuloUnidade(cfg)
  const lista = agrupadores.filter((a) => {
    const f = filtro.trim().toLowerCase()
    return !f || `${a.codigo} ${a.descricao}`.toLowerCase().includes(f)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => void fechar(o)} size="full">
      <DialogHeader className="shrink-0">
        <DialogTitle>
          Quantidades de {trecho.nome}{' '}
          <Badge variant="outline" className="ml-1 align-middle">
            {ehArea ? 'Área' : 'Eixo'}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {ehArea
            ? 'Local sem estacas: uma linha com a quantidade de cada serviço na área inteira.'
            : `De ${estacaInicialTexto(trecho)} a ${estacaFinalTexto(trecho)}, ${formatNumber(comp, 0)} m. Quantidade de cada serviço por faixa de estacas. As tarefas “do template” leem daqui.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex-1 min-h-0 p-0 flex">
        <aside className="w-[270px] shrink-0 border-r border-border flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
              Serviços do orçamento ({contar(sel.size, 'marcado', 'marcados')})
            </div>
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar por código ou nome"
              aria-label="Filtrar serviços do orçamento"
              autoComplete="off"
              className="h-7"
            />
          </div>
          <div className="flex-1 overflow-auto">
            {lista.map((a) => (
              <label
                key={a.id}
                className="flex items-start gap-2 px-3 py-1.5 border-b border-border text-sm hover:bg-bg-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  disabled={!editavel}
                  checked={sel.has(a.id)}
                  onChange={() => {
                    setSel((s) => {
                      const n = new Set(s)
                      if (n.has(a.id)) n.delete(a.id)
                      else n.add(a.id)
                      return n
                    })
                    setSujo(true)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="mr-1 text-text-muted">{a.codigo}</span>
                  <span className="text-text">{a.descricao}</span>
                  <span className="tabular block text-xs text-text-muted">
                    Orçado: {formatNumber(a.quantidade, 3)} {a.unidade} · Nos locais:{' '}
                    {formatNumber(a.totalTrechos, 3)}
                  </span>
                </span>
              </label>
            ))}
            {lista.length === 0 ? (
              <p className="px-3 py-4 text-sm text-text-muted">
                {filtro.trim()
                  ? 'Nenhum serviço com esse filtro.'
                  : 'O orçamento ainda não tem serviços. Agrupe as receitas em serviços na planilha orçamentária.'}
              </p>
            ) : null}
          </div>
          <p className="border-t border-border px-3 py-2 text-xs text-text-muted">
            Os serviços marcados viram colunas. A soma dos locais por serviço não pode passar do
            orçado.
          </p>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
            {!ehArea ? (
              <>
                <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                  Faixas
                </span>
                <Select
                  className="w-44"
                  aria-label="Tamanho das faixas"
                  value={passoTipo}
                  disabled={!editavel}
                  onChange={(e) => {
                    const t = e.target.value as PassoUI
                    aplicarPasso(t, t === 'metros' ? '500' : t === 'unidades' ? '5' : passoN)
                  }}
                >
                  <option value="unidade">A cada {rot}</option>
                  <option value="unidades">A cada N {rot}</option>
                  <option value="metros">A cada N metros</option>
                  <option value="livre">Faixas livres</option>
                </Select>
                {passoTipo === 'unidades' || passoTipo === 'metros' ? (
                  <Input
                    className="tabular w-20 text-right"
                    inputMode="decimal"
                    aria-label={
                      passoTipo === 'metros' ? 'Metros por faixa' : `Quantidade de ${rot} por faixa`
                    }
                    value={passoN}
                    disabled={!editavel}
                    onChange={(e) => setPassoN(e.target.value)}
                    onBlur={() => aplicarPasso(passoTipo, passoN)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') aplicarPasso(passoTipo, passoN)
                    }}
                    title={passoTipo === 'metros' ? 'metros' : rot}
                  />
                ) : null}
                {passoTipo === 'livre' && editavel ? (
                  <Button size="sm" variant="secondary" onClick={addFaixa}>
                    <Plus size={12} /> Adicionar faixa
                  </Button>
                ) : null}
              </>
            ) : null}
            <span className="tabular ml-1 text-sm text-text-muted">
              {contar(segs.length, 'faixa', 'faixas')} ·{' '}
              {atual ? `versão ${atual.numero}` : 'ainda sem versão salva'}
              {sujo ? ' · com alterações não salvas' : ''}
              {plano ? ` · tarefas do plano ${plano.nome}` : ''}
            </span>
            <div className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={verHistorico}
                onClick={() => setVerHistorico((v) => !v)}
              >
                <History size={12} /> Versões ({versoes.length})
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void exportar().catch((e) =>
                    toast.error('Não foi possível exportar a planilha.', {
                      description: (e as Error).message
                    })
                  )
                }
              >
                <Download size={12} /> Exportar
              </Button>
              {editavel ? (
                <Button size="sm" variant="secondary" onClick={() => setImportarOpen(true)}>
                  <Upload size={12} /> Importar planilha
                </Button>
              ) : null}
            </div>
          </div>
          {trava ? (
            <div
              role="status"
              className="border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-text"
            >
              Somente leitura: {trava}.
            </div>
          ) : null}
          {verHistorico ? (
            <div
              className="max-h-40 overflow-auto border-b border-border bg-bg/40"
              tabIndex={0}
              role="region"
              aria-label="Versões salvas das quantidades"
            >
              {versoes.length === 0 ? (
                <p className="px-3 py-2 text-sm text-text-muted">
                  Nenhuma versão salva. A primeira é criada quando você salvar as quantidades.
                </p>
              ) : null}
              {versoes.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 border-b border-border px-3 py-1 text-sm"
                >
                  <span className="tabular font-medium text-text">Versão {v.numero}</span>
                  {v.is_atual ? <Badge variant="accent">Atual</Badge> : null}
                  <span className="text-text-muted flex-1 truncate">{v.comentario ?? ''}</span>
                  <span className="tabular text-text-muted">{formatDate(v.created_at)}</span>
                  {!v.is_atual && editavel ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={restaurar.isPending}
                      aria-label={`Restaurar a versão ${v.numero}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Voltar para a versão ${v.numero}?`,
                          description: 'As tarefas “do template” passam a ler essa versão.',
                          confirmLabel: 'Restaurar'
                        })
                        if (ok)
                          restaurar.mutate(
                            { versao_id: v.id },
                            {
                              onError: (e) =>
                                toast.error('Não foi possível restaurar a versão.', {
                                  description: e.message
                                }),
                              onSuccess: () => toast.success('Versão restaurada.')
                            }
                          )
                      }}
                    >
                      <RotateCcw size={12} /> Restaurar
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex-1 min-h-0">
            {colunas.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
                Marque à esquerda os serviços que têm quantidade neste local. Cada um vira uma
                coluna.
              </div>
            ) : (
              <GradeQuantidades
                segmentos={segs}
                colunas={colunas}
                ctx={ctx}
                tipo={trecho.tipo}
                editavel={editavel}
                livre={passoTipo === 'livre'}
                comprimento={comp}
                onChange={mudar}
                rodape={rodape}
                rotuloTarefas={plano ? `Em tarefas (${plano.nome})` : 'Em tarefas'}
              />
            )}
          </div>
          <div className="border-t border-border px-3 py-2">
            <DialogErrorBanner message={erro} />
            {editavel ? (
              <div className="flex items-end gap-3 flex-wrap">
                <Campo rotulo="Comentário da versão" className="min-w-[220px] flex-1">
                  <Input
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Ex.: projeto executivo, revisão 2"
                    autoComplete="off"
                  />
                </Campo>
                {atual ? (
                  <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={novaVersao}
                      onChange={(e) => setNovaVersao(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Salvar como nova versão
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </DialogBody>
      <DialogFooter className="shrink-0">
        <Button variant="secondary" onClick={() => void fechar(false)}>
          Fechar
        </Button>
        {editavel ? (
          <Button disabled={salvar.isPending} onClick={() => void gravar()}>
            <Save size={12} /> {salvar.isPending ? 'Salvando…' : 'Salvar quantidades'}
          </Button>
        ) : null}
      </DialogFooter>
      <ImportarQuantidadesDialog
        open={importarOpen}
        onOpenChange={setImportarOpen}
        obraId={trecho.obra_id}
        localInicial={trecho}
      />
    </Dialog>
  )
}
