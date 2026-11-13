import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Trash2, X } from 'lucide-react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { fmtBRL, fmtBRL4, fmtPct2, fmtQtd, parseBR } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import {
  useItemDetalhe,
  usePlanOrc,
  useComposicaoViva,
  useUpsertItem,
  useAtualizarAgrupador,
  type AtualizarAgrupadorInput
} from '../hooks/plan-orc'
import { useServicos } from '../hooks/servicos'
import { useLucratividade } from '../hooks/lucratividade'
import { useIndireto } from '../hooks/indireto'
import { CPU_ITEM_GRUPO_LABEL } from '@/types/orcamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useExcluirServico, useRemoverAlocacoes, useSetCompoe } from '../hooks/alocacao'
import { CommentsPanel } from './CommentsPanel'
import { MemoriaEditor } from './MemoriaEditor'
import { AnexosList } from './AnexosList'

/** Receita alocada a um serviço (detalhe do serviço). */
interface ReceitaAlocada {
  alocacaoId: string
  receitaId: string
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number
  venda: number
  fracao: number
  criterio: string
  compoe: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string | null
  obraId: string
  podeEditar: boolean
}

type Tab = 'geral' | 'cpu' | 'comentarios' | 'memoria' | 'anexos'

/** Número para edição: vírgula decimal, sem milhar (o parseBR aceita os dois). */
function numEdit(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',')
}

const TAB_LABELS: Record<Tab, string> = {
  geral: 'Geral',
  cpu: 'Composição',
  comentarios: 'Coment.',
  memoria: 'Memória',
  anexos: 'Anexos'
}

export function ItemDetailPanel({
  open,
  onOpenChange,
  itemId,
  obraId,
  podeEditar
}: Props): ReactNode {
  const [tab, setTab] = useState<Tab>('geral')
  const { data: item, isLoading } = useItemDetalhe(open ? itemId : null)
  const { data: plan } = usePlanOrc(open ? obraId : null)
  const { data: servicos = [] } = useServicos(open ? obraId : null)
  const upsert = useUpsertItem()
  const atualizarAgrupador = useAtualizarAgrupador()
  const confirm = useConfirm()
  // estado da aba Geral: o Salvar fica no rodapé, sempre visível
  const [geral, setGeral] = useState({ dirty: false, salvando: false })
  const salvarGeral = useRef<() => Promise<void>>(async () => {})

  const fechar = async (): Promise<void> => {
    if (geral.dirty) {
      const ok = await confirm({
        title: 'Descartar as alterações?',
        description: 'Há alterações na aba Geral que ainda não foram salvas.',
        confirmLabel: 'Descartar',
        variant: 'danger'
      })
      if (!ok) return
    }
    onOpenChange(false)
  }

  const servicosFolha = useMemo(() => servicos.filter((s) => s.unidade !== null), [servicos])
  // Receitas alocadas ao serviço atual (planilha de venda → serviço, com fração).
  const alocadas = useMemo<ReceitaAlocada[]>(() => {
    if (!item || item.tipo !== 'servico_grupo' || !plan) return []
    const receitas = new Map(plan.flat.map((n) => [n.id, n]))
    return plan.alocacoes
      .filter((a) => a.grupo_id === item.id)
      .map((a) => {
        const r = receitas.get(a.receita_id)
        return {
          alocacaoId: a.id,
          receitaId: a.receita_id,
          codigo: r?.codigo ?? '?',
          descricao: r?.descricao ?? '',
          unidade: r?.unidade ?? null,
          quantidade: Number(r?.quantidade ?? 0),
          venda: Number(r?.venda_total_calc ?? 0),
          fracao: a.fracao,
          criterio: a.criterio,
          compoe: a.compoe_qtd
        }
      })
      .sort((x, y) => x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }))
  }, [plan, item])

  if (!open) return null

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : void fechar())}>
      <SheetHeader>
        <SheetTitle>{item ? `${item.codigo} — ${item.descricao}` : 'Item'}</SheetTitle>
        <div className="flex gap-1 mt-2 flex-wrap">
          {(['geral', 'cpu', 'comentarios', 'memoria', 'anexos'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded bg-accent-glow text-accent border border-accent-line'
                  : 'px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded text-text-muted hover:text-text hover:bg-bg-hover border border-transparent'
              }
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </SheetHeader>
      <SheetBody>
        {isLoading || !item ? (
          <div className="text-xs text-text-muted font-mono">Carregando…</div>
        ) : (
          <>
            <div className={tab === 'geral' ? '' : 'hidden'}>
              <GeralTab
                key={item.id}
                onEstado={setGeral}
                salvarRef={salvarGeral}
                item={item}
                obraId={obraId}
                podeEditar={podeEditar}
                servicosFolha={servicosFolha}
                servicosDaObra={plan?.servicos ?? []}
                alocadas={alocadas}
                onSave={(patch) =>
                  upsert.mutateAsync({ id: item.id, obra_id: obraId, tipo: item.tipo, ...patch })
                }
                onSaveAgrupador={(input) =>
                  atualizarAgrupador.mutateAsync({ ...input, id: item.id, obra_id: obraId })
                }
                onExcluido={() => onOpenChange(false)}
              />
            </div>
            {tab === 'geral' ? null : tab === 'cpu' ? (
              <CpuTab item={item} />
            ) : tab === 'comentarios' ? (
              <CommentsPanel itemId={item.id} />
            ) : tab === 'memoria' ? (
              <MemoriaEditor itemId={item.id} podeEditar={podeEditar} />
            ) : (
              <AnexosList
                obraId={obraId}
                escopo="item"
                escopoId={item.id}
                podeEditar={podeEditar}
              />
            )}
          </>
        )}
      </SheetBody>
      <SheetFooter>
        {geral.dirty ? (
          <span className="mr-auto text-2xs text-warn">Alterações não salvas</span>
        ) : null}
        <Button variant="ghost" onClick={() => void fechar()}>
          Fechar
        </Button>
        {podeEditar && item ? (
          <Button
            variant="default"
            onClick={() => void salvarGeral.current()}
            disabled={!geral.dirty || geral.salvando}
          >
            {geral.salvando ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        ) : null}
      </SheetFooter>
    </Sheet>
  )
}

function GeralTab({
  item,
  obraId,
  podeEditar,
  servicosFolha,
  servicosDaObra,
  alocadas,
  onSave,
  onSaveAgrupador,
  onExcluido,
  onEstado,
  salvarRef
}: {
  item: ReturnType<typeof useItemDetalhe>['data'] & object
  obraId: string
  podeEditar: boolean
  servicosFolha: { id: string; codigo: string; nome: string; unidade: string | null }[]
  servicosDaObra: { id: string; codigo: string | null; indireto_id: string | null }[]
  alocadas: ReceitaAlocada[]
  onSave: (patch: Record<string, unknown>) => Promise<unknown>
  onSaveAgrupador: (input: Omit<AtualizarAgrupadorInput, 'id' | 'obra_id'>) => Promise<unknown>
  onExcluido: () => void
  onEstado: (e: { dirty: boolean; salvando: boolean }) => void
  salvarRef: { current: () => Promise<void> }
}): ReactNode {
  const confirm = useConfirm()
  const setCompoe = useSetCompoe()
  const remover = useRemoverAlocacoes()
  const excluir = useExcluirServico()
  const [descricao, setDescricao] = useState(item.descricao)
  const [unidade, setUnidade] = useState(item.unidade ?? '')
  const [quantidade, setQuantidade] = useState(numEdit(item.quantidade))
  const [vendaUnit, setVendaUnit] = useState(numEdit(item.venda_unitaria))
  const [qtdRef, setQtdRef] = useState(numEdit(item.quantidade_referencia))
  const [manual, setManual] = useState(item.qtd_ref_modo === 'manual')
  const [unidadeRef, setUnidadeRef] = useState<string>(item.unidade_referencia ?? '')
  const [servicoId, setServicoId] = useState<string>(item.servico_id ?? '')
  const [origem, setOrigem] = useState<'composicao' | 'indireto'>(
    item.indireto_id ? 'indireto' : 'composicao'
  )
  const [indiretoId, setIndiretoId] = useState<string>(item.indireto_id ?? '')
  const [dirty, setDirty] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const isReceita = item.tipo === 'receita'
  const isServicoGrupo = item.tipo === 'servico_grupo'
  const ehIndireto = isServicoGrupo && origem === 'indireto'
  const { data: indiretos = [] } = useIndireto(isServicoGrupo ? obraId : null)
  const indiretoSel = indiretos.find((i) => i.id === indiretoId) ?? null
  // item de indireto já usado por outro serviço (evita contar o custo duas vezes)
  const indiretoUsadoPor = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of servicosDaObra)
      if (s.indireto_id && s.id !== item.id) m.set(s.indireto_id, s.codigo ?? '?')
    return m
  }, [servicosDaObra, item.id])

  const qtdAuto = alocadas.filter((a) => a.compoe).reduce((s, a) => s + a.quantidade * a.fracao, 0)

  // Prévia do custo do serviço com a composição/quantidade escolhidas (antes de salvar)
  const { data: compSel, isLoading: carregandoComp } = useComposicaoViva(
    isServicoGrupo && !ehIndireto && servicoId ? servicoId : null
  )
  const previa = (() => {
    if (!isServicoGrupo || !dirty) return null
    if (ehIndireto) {
      if (!indiretoSel) return { custoUnit: null, custoTotal: 0 }
      const qtdI = manual ? parseBR(qtdRef).toNumber() || 0 : qtdAuto
      const cuI = Number(indiretoSel.valor_total ?? 0)
      return { custoUnit: cuI, custoTotal: cuI * qtdI }
    }
    if (!servicoId) return { custoUnit: null, custoTotal: 0 }
    if (!compSel) return null
    const qtd = manual ? parseBR(qtdRef).toNumber() || 0 : qtdAuto
    const cu = Number(compSel.custo_unit ?? 0)
    return { custoUnit: cu, custoTotal: cu * qtd }
  })()
  const custoUnitExib = previa ? previa.custoUnit : item.custo_unitario_calc
  const custoTotalExib = previa ? previa.custoTotal : Number(item.custo_total_calc ?? 0)
  const vendaTotal = Number(item.venda_total_calc ?? 0)
  // mesma conta do banco: desconta a taxa vigente cadastrada em Taxas
  const { data: lucrObra } = useLucratividade(previa ? obraId : null)
  const aliquota = lucrObra?.aliquota_total_perc ?? 0
  const lucroExib = previa
    ? vendaTotal > 0 && custoTotalExib > 0
      ? (vendaTotal - custoTotalExib - vendaTotal * aliquota) / vendaTotal
      : null
    : item.lucratividade_perc_calc

  const trocarServico = (id: string): void => {
    setServicoId(id)
    setDirty(true)
    const s = servicosFolha.find((x) => x.id === id)
    if (s?.unidade) setUnidadeRef(s.unidade)
  }

  const save = async (): Promise<void> => {
    setSalvando(true)
    try {
      if (isServicoGrupo) {
        const qtdManual = parseBR(qtdRef).toNumber() || 0
        if (manual && qtdManual <= 0) {
          toast.error('Informe a quantidade de referência (> 0).')
          return
        }
        if (ehIndireto && !indiretoId) {
          toast.error('Escolha o item de indireto.')
          return
        }
        const novoServico = ehIndireto ? null : servicoId || null
        await onSaveAgrupador({
          descricao: descricao.trim(),
          servico_id: novoServico,
          indireto_id: ehIndireto ? indiretoId : null,
          unidade_referencia: unidadeRef.trim() || item.unidade_referencia || null,
          qtd_ref_modo: manual ? 'manual' : 'soma_filhos',
          quantidade_referencia: manual ? qtdManual : qtdAuto
        })
      } else {
        const patch: Record<string, unknown> = { descricao: descricao.trim() }
        if (isReceita) {
          patch.unidade = unidade.trim() === '' ? null : unidade.trim()
          patch.quantidade = quantidade.trim() === '' ? null : parseBR(quantidade).toNumber()
          patch.venda_unitaria = vendaUnit.trim() === '' ? null : parseBR(vendaUnit).toNumber()
        }
        await onSave(patch)
      }
      setDirty(false)
      toast.success('Item salvo.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  useEffect(() => {
    salvarRef.current = save
  })
  useEffect(() => {
    onEstado({ dirty, salvando })
  }, [dirty, salvando, onEstado])

  const excluirServico = async (): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o serviço "${item.codigo} ${item.descricao}"?`,
      description:
        alocadas.length > 0
          ? `${contar(alocadas.length, 'receita deixa de estar alocada', 'receitas deixam de estar alocadas')} a ele (${fmtBRL(
              alocadas.reduce((s, a) => s + a.venda * a.fracao, 0)
            )} voltam a ficar sem agrupamento). A planilha de venda não muda.`
          : 'O serviço não tem receitas alocadas.',
      confirmLabel: 'Excluir serviço',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await excluir.mutateAsync({ obra_id: obraId, id: item.id })
      toast.success('Serviço excluído.')
      onExcluido()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir serviço')
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div>
        <Label htmlFor="g-desc">Descrição</Label>
        <Input
          id="g-desc"
          value={descricao}
          onChange={(e) => {
            setDescricao(e.target.value)
            setDirty(true)
          }}
          disabled={!podeEditar}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Código</Label>
          <div className="text-text font-mono">{item.codigo}</div>
        </div>
        <div>
          <Label>Tipo</Label>
          <div className="text-text font-mono">
            {item.tipo === 'etapa' ? 'Índice' : isServicoGrupo ? 'Serviço' : 'Receita'}
          </div>
        </div>
        {isReceita ? (
          <div>
            <Label htmlFor="g-un">Unidade</Label>
            <Input
              id="g-un"
              value={unidade}
              onChange={(e) => {
                setUnidade(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
              placeholder="m, m², m³, un, kg…"
            />
          </div>
        ) : null}
      </div>

      {isReceita ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="g-qtd">Quantidade</Label>
            <Input
              id="g-qtd"
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => {
                setQuantidade(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
            />
          </div>
          <div>
            <Label htmlFor="g-vu">Venda unitária</Label>
            <Input
              id="g-vu"
              inputMode="decimal"
              value={vendaUnit}
              onChange={(e) => {
                setVendaUnit(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
            />
          </div>
        </div>
      ) : isServicoGrupo ? (
        <div className="space-y-3">
          <div>
            <Label className="block">Custo vem de</Label>
            <div className="inline-flex rounded border border-border-strong overflow-hidden">
              {(
                [
                  { v: 'composicao', l: 'Composição' },
                  { v: 'indireto', l: 'Indireto' }
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  disabled={!podeEditar}
                  onClick={() => {
                    if (origem === o.v) return
                    setOrigem(o.v)
                    setDirty(true)
                    if (o.v === 'indireto' && !unidadeRef.trim()) setUnidadeRef('VB')
                  }}
                  className={
                    origem === o.v
                      ? 'px-3 py-1 text-2xs bg-accent text-[color:var(--on-accent)]'
                      : 'px-3 py-1 text-2xs text-text-muted hover:bg-bg-hover'
                  }
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          {ehIndireto ? (
            <div>
              <Label htmlFor="g-indireto">Item do indireto</Label>
              <Select
                id="g-indireto"
                value={indiretoId}
                onChange={(e) => {
                  setIndiretoId(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
              >
                <option value="">— selecione —</option>
                {indiretos.map((i) => {
                  const usado = indiretoUsadoPor.get(i.id)
                  return (
                    <option key={i.id} value={i.id} disabled={!!usado}>
                      {i.codigo} · {i.descricao} · {fmtBRL(i.valor_total)}
                      {usado ? ` (já vinculado a ${usado})` : ''}
                    </option>
                  )
                })}
              </Select>
              {indiretos.length === 0 ? (
                <p className="text-2xs font-mono text-warn mt-0.5">
                  Nenhum item cadastrado em Catálogos da obra → Indireto.
                </p>
              ) : indiretoSel ? (
                <p className="text-2xs font-mono text-text-dim mt-0.5">
                  Custo do serviço = {fmtBRL(indiretoSel.valor_total)} × quantidade de referência.
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              <Label htmlFor="g-servico">Composição de custo</Label>
              <Select
                id="g-servico"
                value={servicoId}
                onChange={(e) => trocarServico(e.target.value)}
                disabled={!podeEditar}
              >
                <option value="">— sem composição —</option>
                {servicosFolha.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} · {s.nome} ({s.unidade})
                  </option>
                ))}
              </Select>
              {!servicoId ? (
                <p className="text-2xs font-mono text-warn mt-0.5">
                  Sem composição: o serviço soma a venda, mas fica fora de custo, programação e
                  produção.
                </p>
              ) : servicoId !== (item.servico_id ?? '') ? (
                <p className="text-2xs font-mono text-warn mt-0.5">
                  O custo passa a vir da composição escolhida ao salvar.
                </p>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantidade de referência</Label>
              <div className="inline-flex rounded border border-border-strong overflow-hidden">
                {[
                  { v: false, l: 'Automática' },
                  { v: true, l: 'Manual' }
                ].map((o) => (
                  <button
                    key={o.l}
                    type="button"
                    disabled={!podeEditar}
                    onClick={() => {
                      setManual(o.v)
                      setDirty(true)
                    }}
                    className={
                      manual === o.v
                        ? 'px-3 py-1 text-2xs bg-accent text-[color:var(--primary-foreground)]'
                        : 'px-3 py-1 text-2xs text-text-muted hover:bg-bg-hover'
                    }
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="g-unref">Unidade</Label>
              <Input
                id="g-unref"
                value={unidadeRef}
                onChange={(e) => {
                  setUnidadeRef(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
                placeholder="m, m², m³, t…"
              />
            </div>
          </div>
          {manual ? (
            <div>
              <Label htmlFor="g-qtdref">Quantidade (manual)</Label>
              <Input
                id="g-qtdref"
                inputMode="decimal"
                value={qtdRef}
                onChange={(e) => {
                  setQtdRef(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
              />
            </div>
          ) : (
            <p className="text-2xs font-mono text-text-dim">
              Soma das receitas marcadas em “compõe” × fração:{' '}
              <span className="text-text">{fmtQtd(qtdAuto)}</span>{' '}
              {unidadeRef || item.unidade_referencia || ''} — acompanha a planilha de venda.
            </p>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Receitas alocadas ({alocadas.length})</Label>
              <span className="text-2xs font-mono text-text-dim">
                venda {fmtBRL(alocadas.reduce((s, a) => s + a.venda * a.fracao, 0))}
              </span>
            </div>
            {alocadas.length === 0 ? (
              <div className="text-2xs font-mono text-text-dim">
                Nenhuma receita. Selecione receitas na planilha e use “Agrupar em…”, ou arraste-as
                para este serviço no painel.
              </div>
            ) : (
              <div className="rounded border border-border divide-y divide-border">
                {alocadas.map((a) => (
                  <div key={a.alocacaoId} className="flex items-center gap-2 px-2 py-1">
                    <input
                      type="checkbox"
                      checked={a.compoe}
                      disabled={!podeEditar || setCompoe.isPending || manual}
                      onChange={(e) =>
                        setCompoe.mutate(
                          { obra_id: obraId, id: a.alocacaoId, compoe: e.target.checked },
                          { onError: (err) => toast.error(err.message) }
                        )
                      }
                      title={manual ? 'Quantidade manual' : 'Compõe a quantidade do serviço'}
                      className="shrink-0 accent-[color:var(--accent)]"
                    />
                    <span className="text-text-muted font-mono w-14 truncate shrink-0">
                      {a.codigo}
                    </span>
                    <span className="text-text flex-1 truncate" title={a.descricao}>
                      {a.descricao}
                    </span>
                    <span
                      className="text-2xs font-mono tabular-nums text-text-dim w-12 text-right"
                      title={`critério: ${a.criterio}`}
                    >
                      {fmtPct2(a.fracao)}
                    </span>
                    <span className="text-2xs font-mono tabular-nums text-text w-24 text-right">
                      {fmtBRL(a.venda * a.fracao)}
                    </span>
                    {podeEditar ? (
                      <button
                        type="button"
                        onClick={() =>
                          remover.mutate(
                            { obra_id: obraId, ids: [a.alocacaoId] },
                            { onError: (err) => toast.error(err.message) }
                          )
                        }
                        title="Remover do serviço"
                        className="w-5 h-5 grid place-items-center rounded text-text-dim hover:text-danger hover:bg-bg-hover"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-2 grid grid-cols-2 gap-3 font-mono">
        {previa || (dirty && carregandoComp) ? (
          <div className="col-span-2 text-2xs text-warn">
            {carregandoComp ? 'Calculando prévia…' : 'Prévia — vale depois de salvar'}
          </div>
        ) : null}
        <Metric
          label="Custo unitário"
          value={
            custoUnitExib !== null && custoUnitExib !== undefined ? fmtBRL4(custoUnitExib) : '—'
          }
        />
        <Metric label="Custo total" value={fmtBRL(custoTotalExib)} />
        <Metric label="Venda total" value={fmtBRL(vendaTotal)} />
        <Metric
          label="Lucratividade"
          value={lucroExib !== null && lucroExib !== undefined ? fmtPct2(lucroExib) : '—'}
        />
      </div>
      {isServicoGrupo && compSel && Number(compSel.custo_unit ?? 0) === 0 ? (
        <div className="text-2xs text-warn">
          A composição escolhida está com custo zero — confira os preços dos recursos dela.
        </div>
      ) : null}

      {podeEditar ? (
        <div className="flex items-center justify-between pt-2">
          {isServicoGrupo ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:bg-danger/10"
              onClick={() => void excluirServico()}
              disabled={excluir.isPending}
            >
              <Trash2 size={12} /> Excluir serviço
            </Button>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-text-dim">{label}</div>
      <div className="text-text tabular-nums">{value}</div>
    </div>
  )
}

function CpuTab({ item }: { item: ReturnType<typeof useItemDetalhe>['data'] & object }): ReactNode {
  const { data: comp, isLoading } = useComposicaoViva(item.servico_id)
  if (item.indireto_id) {
    return (
      <div className="text-xs text-text-muted font-mono">
        O custo deste serviço vem de um item do Indireto (aba Geral), não de composição.
      </div>
    )
  }
  if (!item.servico_id) {
    return (
      <div className="text-xs text-text-muted font-mono">
        Nenhuma composição vinculada. Vincule uma na aba Geral.
      </div>
    )
  }
  if (isLoading) return <div className="text-xs text-text-muted font-mono">Carregando…</div>
  if (!comp) {
    return <div className="text-xs text-text-muted font-mono">Composição não encontrada.</div>
  }
  return (
    <div className="space-y-3 text-xs">
      <div className="text-2xs font-mono text-text-dim">
        Valores ao vivo da composição vigente — mudanças em recursos e composições refletem aqui na
        hora.
      </div>
      <div className="grid grid-cols-2 gap-3 font-mono">
        <Metric label="Custo unit." value={fmtBRL4(comp.custo_unit ?? 0)} />
        <Metric
          label="Produção/dia"
          value={`${fmtQtd(comp.producao_diaria_qtde ?? 0)} ${comp.producao_diaria_unidade ?? ''}`}
        />
        <Metric label="EQ/dia" value={fmtBRL(comp.custo_eq_dia ?? 0)} />
        <Metric label="Comb/dia" value={fmtBRL(comp.custo_comb_dia ?? 0)} />
        <Metric label="MO/dia" value={fmtBRL(comp.custo_mo_dia ?? 0)} />
        <Metric label="Mat/dia" value={fmtBRL(comp.custo_mat_dia ?? 0)} />
      </div>

      <div>
        <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">
          Insumos
        </div>
        <div className="rounded border border-border">
          <table className="w-full text-2xs font-mono">
            <thead className="text-text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1">Grupo</th>
                <th className="text-left px-2 py-1">Recurso</th>
                <th className="text-right px-2 py-1">Qtd</th>
                <th className="text-right px-2 py-1">Custo/dia</th>
              </tr>
            </thead>
            <tbody>
              {comp.itens.map((it) => (
                <tr key={it.id} className="border-b border-border">
                  <td className="px-2 py-1 text-text-dim">{CPU_ITEM_GRUPO_LABEL[it.grupo]}</td>
                  <td
                    className="px-2 py-1 text-text truncate max-w-[180px]"
                    title={it.recurso?.nome}
                  >
                    {it.recurso?.nome ?? '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtQtd(it.quantidade)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-text">
                    {fmtBRL(it.custo_total_calc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
