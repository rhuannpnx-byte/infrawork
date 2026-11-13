import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Trash2, X } from 'lucide-react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Campo } from '@/components/ui/campo'
import { Segmentado } from '@/components/ui/segmentado'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
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
import { CPU_ITEM_GRUPO_LABEL, type CriterioRateio, type ItemDetalhe } from '@/types/orcamento'
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
  criterio: CriterioRateio
  compoe: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string | null
  obraId: string
  podeEditar: boolean
  /** Por que o item não pode ser editado (aparece no topo da aba Geral). */
  motivoSomenteLeitura?: string
}

type Tab = 'geral' | 'cpu' | 'comentarios' | 'memoria' | 'anexos'

/** Número para edição: vírgula decimal, sem milhar (o parseBR aceita os dois). */
function numEdit(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',')
}

const TABS: Tab[] = ['geral', 'cpu', 'comentarios', 'memoria', 'anexos']

const TAB_LABELS: Record<Tab, string> = {
  geral: 'Geral',
  cpu: 'Composição',
  comentarios: 'Comentários',
  memoria: 'Memória',
  anexos: 'Anexos'
}

const CRITERIO_ROTULO: Record<CriterioRateio, string> = {
  percentual: 'percentual',
  peso: 'quantidade física',
  venda: 'proporcional à venda'
}

const ROTULO = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

/** Só algarismos, ponto e vírgula: o que o `parseBR` entende como número. */
const NUMERO = /^\d[\d.,]*$/

export function ItemDetailPanel({
  open,
  onOpenChange,
  itemId,
  obraId,
  podeEditar,
  motivoSomenteLeitura
}: Props): ReactNode {
  const [tab, setTab] = useState<Tab>('geral')
  // enquanto o serviço é excluído a consulta do item fica parada, para não reler o que acabou de sumir
  const [excluindo, setExcluindo] = useState<ItemDetalhe | null>(null)
  const consultaItem = useItemDetalhe(open && !excluindo ? itemId : null)
  const item = excluindo ?? consultaItem.data
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

  const aoTeclarAbas = (e: KeyboardEvent<HTMLDivElement>): void => {
    const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!passo) return
    e.preventDefault()
    const proxima = TABS[(TABS.indexOf(tab) + passo + TABS.length) % TABS.length]
    setTab(proxima)
    e.currentTarget.querySelector<HTMLElement>(`[data-aba="${proxima}"]`)?.focus()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : void fechar())}>
      <SheetHeader>
        <SheetTitle>
          {item ? (
            <>
              <span className="tabular font-normal text-text-muted">{item.codigo}</span>{' '}
              {item.descricao}
            </>
          ) : (
            'Item'
          )}
        </SheetTitle>
        <div
          role="tablist"
          aria-label="Seções do item"
          onKeyDown={aoTeclarAbas}
          className="flex gap-0.5 mt-2 flex-wrap"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              data-aba={t}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'h-7 px-2 text-xs font-semibold rounded bg-accent-glow text-accent border border-accent-line'
                  : 'h-7 px-2 text-xs font-medium rounded text-text-muted hover:text-text hover:bg-bg-hover border border-transparent'
              }
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </SheetHeader>
      <SheetBody>
        {!item && consultaItem.error ? (
          <ErroConsulta
            erro={consultaItem.error}
            oQue="o item"
            aoTentar={() => void consultaItem.refetch()}
            compacto
          />
        ) : !item ? (
          <Carregando className="py-2" />
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
                motivoSomenteLeitura={motivoSomenteLeitura}
                onExcluindo={(sim) => setExcluindo(sim ? item : null)}
                servicosFolha={servicosFolha}
                servicosDaObra={plan?.servicos ?? []}
                alocadas={alocadas}
                onSave={(patch) =>
                  upsert.mutateAsync({ id: item.id, obra_id: obraId, tipo: item.tipo, ...patch })
                }
                onSaveAgrupador={(input) =>
                  atualizarAgrupador.mutateAsync({ ...input, id: item.id, obra_id: obraId })
                }
                onExcluido={() => {
                  setExcluindo(null)
                  onOpenChange(false)
                }}
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
          <span className="mr-auto text-xs font-medium text-warn">Alterações não salvas</span>
        ) : null}
        <Button variant="ghost" onClick={() => void fechar()}>
          Fechar
        </Button>
        {podeEditar && item ? (
          <Button
            variant="default"
            onClick={() => void salvarGeral.current()}
            disabled={!geral.dirty || geral.salvando}
            title={!geral.dirty ? 'Nada foi alterado na aba Geral.' : undefined}
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
  onExcluindo,
  onEstado,
  salvarRef,
  motivoSomenteLeitura
}: {
  item: ItemDetalhe
  obraId: string
  podeEditar: boolean
  motivoSomenteLeitura?: string
  onExcluindo: (sim: boolean) => void
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
  const [tentou, setTentou] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
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

  const numeroInvalido = (texto: string): boolean =>
    !NUMERO.test(texto.trim()) || !Number.isFinite(parseBR(texto).toNumber())
  const erros: Partial<
    Record<'descricao' | 'unidade' | 'quantidade' | 'venda' | 'qtdRef' | 'indireto', string>
  > = {}
  if (!descricao.trim()) erros.descricao = 'Informe a descrição.'
  if (isReceita) {
    if (!unidade.trim()) erros.unidade = 'Informe a unidade, como m³, t ou km.'
    if (!quantidade.trim()) erros.quantidade = 'Informe a quantidade.'
    else if (numeroInvalido(quantidade))
      erros.quantidade = 'Digite a quantidade como um número, por exemplo 1.250,5.'
    if (!vendaUnit.trim()) erros.venda = 'Informe a venda unitária.'
    else if (numeroInvalido(vendaUnit))
      erros.venda = 'Digite a venda unitária como um número, por exemplo 38,50.'
  }
  if (isServicoGrupo) {
    if (manual && (numeroInvalido(qtdRef) || parseBR(qtdRef).toNumber() <= 0))
      erros.qtdRef = 'Informe a quantidade de referência, maior que zero.'
    if (ehIndireto && !indiretoId) erros.indireto = 'Escolha o item do indireto.'
  }
  const erro = (c: keyof typeof erros): string | undefined => (tentou ? erros[c] : undefined)

  const save = async (): Promise<void> => {
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      requestAnimationFrame(() =>
        caixa.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      )
      return
    }
    setSalvando(true)
    try {
      if (isServicoGrupo) {
        const qtdManual = parseBR(qtdRef).toNumber() || 0
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
      setTentou(false)
      toast.success('Item salvo.')
    } catch (err) {
      const detalhe = (err as { message?: string } | null)?.message
      toast.error(`Não foi possível salvar o item. ${detalhe ?? 'Tente de novo.'}`)
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
    onExcluindo(true)
    try {
      await excluir.mutateAsync({ obra_id: obraId, id: item.id })
      toast.success('Serviço excluído.')
      onExcluido()
    } catch (err) {
      onExcluindo(false)
      const detalhe = (err as { message?: string } | null)?.message
      toast.error(`Não foi possível excluir o serviço. ${detalhe ?? 'Tente de novo.'}`)
    }
  }

  const avisarFalha = (oQue: string) => (err: { message?: string }) =>
    toast.error(`Não foi possível ${oQue}. ${err.message ?? 'Tente de novo.'}`)
  const dicaLeitura = !podeEditar ? motivoSomenteLeitura : undefined

  return (
    <div ref={caixa} className="space-y-3 text-sm">
      {dicaLeitura ? (
        <p className="rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-text">
          {dicaLeitura}
        </p>
      ) : null}
      <Campo rotulo="Descrição" obrigatorio erro={erro('descricao')}>
        <Input
          value={descricao}
          onChange={(e) => {
            setDescricao(e.target.value)
            setDirty(true)
          }}
          disabled={!podeEditar}
          title={dicaLeitura}
        />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={ROTULO}>Código</div>
          <div className="tabular text-text">{item.codigo}</div>
        </div>
        <div>
          <div className={ROTULO}>Tipo</div>
          <div className="text-text">
            {item.tipo === 'etapa' ? 'Índice' : isServicoGrupo ? 'Serviço' : 'Receita'}
          </div>
        </div>
      </div>

      {isReceita ? (
        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="Unidade" obrigatorio erro={erro('unidade')}>
            <Input
              value={unidade}
              onChange={(e) => {
                setUnidade(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
              title={dicaLeitura}
              placeholder="m³, t, km…"
            />
          </Campo>
          <Campo rotulo="Quantidade" obrigatorio erro={erro('quantidade')}>
            <Input
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => {
                setQuantidade(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
              title={dicaLeitura}
              className="tabular text-right"
            />
          </Campo>
          <Campo rotulo="Venda unit. (R$)" obrigatorio erro={erro('venda')}>
            <Input
              inputMode="decimal"
              value={vendaUnit}
              onChange={(e) => {
                setVendaUnit(e.target.value)
                setDirty(true)
              }}
              disabled={!podeEditar}
              title={dicaLeitura}
              className="tabular text-right"
            />
          </Campo>
        </div>
      ) : isServicoGrupo ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">Custo vem de</span>
            <Segmentado
              rotulo="De onde vem o custo do serviço"
              tamanho="sm"
              className="self-start"
              valor={origem}
              aoMudar={(v) => {
                if (origem === v) return
                setOrigem(v)
                setDirty(true)
                if (v === 'indireto' && !unidadeRef.trim()) setUnidadeRef('VB')
              }}
              opcoes={[
                {
                  valor: 'composicao',
                  rotulo: 'Composição',
                  desabilitado: !podeEditar,
                  titulo: dicaLeitura
                },
                {
                  valor: 'indireto',
                  rotulo: 'Indireto',
                  desabilitado: !podeEditar,
                  titulo: dicaLeitura
                }
              ]}
            />
          </div>
          {ehIndireto ? (
            <Campo
              rotulo="Item do indireto"
              obrigatorio
              erro={erro('indireto')}
              dica={
                indiretos.length === 0
                  ? 'Nenhum custo indireto cadastrado. Cadastre em Orçamento, Indireto.'
                  : indiretoSel
                    ? `Custo do serviço = ${fmtBRL(indiretoSel.valor_total)} × quantidade de referência.`
                    : undefined
              }
            >
              <Select
                value={indiretoId}
                onChange={(e) => {
                  setIndiretoId(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
                title={dicaLeitura}
              >
                <option value="">Selecione…</option>
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
            </Campo>
          ) : (
            <Campo
              rotulo="Composição de custo"
              dica={
                !servicoId ? (
                  <span className="text-warn">
                    Sem composição: o serviço soma a venda, mas fica fora de custo, programação e
                    produção.
                  </span>
                ) : servicoId !== (item.servico_id ?? '') ? (
                  <span className="text-warn">
                    O custo passa a vir da composição escolhida ao salvar.
                  </span>
                ) : undefined
              }
            >
              <Select
                value={servicoId}
                onChange={(e) => trocarServico(e.target.value)}
                disabled={!podeEditar}
                title={dicaLeitura}
              >
                <option value="">Sem composição</option>
                {servicosFolha.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} · {s.nome} ({s.unidade})
                  </option>
                ))}
              </Select>
            </Campo>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text">Quantidade de referência</span>
              <Segmentado
                rotulo="Quantidade de referência"
                tamanho="sm"
                className="self-start"
                valor={manual ? 'manual' : 'automatica'}
                aoMudar={(v) => {
                  setManual(v === 'manual')
                  setDirty(true)
                }}
                opcoes={[
                  {
                    valor: 'automatica',
                    rotulo: 'Automática',
                    desabilitado: !podeEditar,
                    titulo: dicaLeitura
                  },
                  {
                    valor: 'manual',
                    rotulo: 'Manual',
                    desabilitado: !podeEditar,
                    titulo: dicaLeitura
                  }
                ]}
              />
            </div>
            <Campo rotulo="Unidade">
              <Input
                value={unidadeRef}
                onChange={(e) => {
                  setUnidadeRef(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
                title={dicaLeitura}
                placeholder="m³, t, km…"
              />
            </Campo>
          </div>
          {manual ? (
            <Campo rotulo="Quantidade (manual)" obrigatorio erro={erro('qtdRef')}>
              <Input
                inputMode="decimal"
                value={qtdRef}
                onChange={(e) => {
                  setQtdRef(e.target.value)
                  setDirty(true)
                }}
                disabled={!podeEditar}
                title={dicaLeitura}
                className="tabular text-right"
              />
            </Campo>
          ) : (
            <p className="text-xs text-text-muted">
              Soma das receitas marcadas em “compõe” × fração:{' '}
              <span className="tabular font-medium text-text">
                {fmtQtd(qtdAuto)} {unidadeRef || item.unidade_referencia || ''}
              </span>
              . Acompanha a planilha de venda.
            </p>
          )}

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-text">
                Receitas alocadas ({alocadas.length})
              </span>
              <span className="tabular text-xs text-text-muted">
                Venda: {fmtBRL(alocadas.reduce((s, a) => s + a.venda * a.fracao, 0))}
              </span>
            </div>
            {alocadas.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nenhuma receita. Selecione receitas na planilha e use “Agrupar em um serviço”, ou
                arraste-as para este serviço no painel.
              </p>
            ) : (
              <ul className="rounded border border-border divide-y divide-border">
                {alocadas.map((a) => (
                  <li key={a.alocacaoId} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={a.compoe}
                      disabled={!podeEditar || setCompoe.isPending || manual}
                      onChange={(e) =>
                        setCompoe.mutate(
                          { obra_id: obraId, id: a.alocacaoId, compoe: e.target.checked },
                          { onError: avisarFalha('mudar o que compõe a quantidade') }
                        )
                      }
                      aria-label={`${a.codigo} compõe a quantidade do serviço`}
                      title={
                        !podeEditar
                          ? dicaLeitura
                          : manual
                            ? 'A quantidade de referência está em modo manual'
                            : 'Compõe a quantidade do serviço'
                      }
                      className="h-4 w-4 shrink-0 accent-[color:var(--accent)]"
                    />
                    <span className="tabular w-14 shrink-0 truncate text-text-muted">
                      {a.codigo}
                    </span>
                    <span className="flex-1 truncate text-text" title={a.descricao}>
                      {a.descricao}
                    </span>
                    <span
                      className="tabular w-14 text-right text-text-muted"
                      title={`Critério do rateio: ${CRITERIO_ROTULO[a.criterio] ?? a.criterio}`}
                    >
                      {fmtPct2(a.fracao)}
                    </span>
                    <span className="tabular w-24 text-right text-text">
                      {fmtBRL(a.venda * a.fracao)}
                    </span>
                    {podeEditar ? (
                      <button
                        type="button"
                        onClick={() =>
                          remover.mutate(
                            { obra_id: obraId, ids: [a.alocacaoId] },
                            { onError: avisarFalha('remover a receita do serviço') }
                          )
                        }
                        disabled={remover.isPending}
                        title="Remover do serviço"
                        aria-label={`Remover ${a.codigo} do serviço`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-dim hover:bg-danger/10 hover:text-danger"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-2 grid grid-cols-2 gap-3">
        {previa || (dirty && carregandoComp) ? (
          <div role="status" className="col-span-2 text-xs font-medium text-warn">
            {carregandoComp ? 'Calculando a prévia…' : 'Prévia: passa a valer depois de salvar.'}
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
        <p className="text-xs font-medium text-warn">
          A composição escolhida está com custo zero: confira os preços dos recursos dela.
        </p>
      ) : null}

      {podeEditar && isServicoGrupo ? (
        <div className="pt-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger/10"
            onClick={() => void excluirServico()}
            disabled={excluir.isPending}
          >
            <Trash2 size={12} /> {excluir.isPending ? 'Excluindo…' : 'Excluir serviço'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className={ROTULO}>{label}</div>
      <div className="text-sm text-text tabular">{value}</div>
    </div>
  )
}

function CpuTab({ item }: { item: ItemDetalhe }): ReactNode {
  const { data: comp, isLoading, error, refetch } = useComposicaoViva(item.servico_id)
  if (item.indireto_id) {
    return (
      <p className="text-sm text-text-muted">
        O custo deste serviço vem de um item do indireto (aba Geral), não de composição.
      </p>
    )
  }
  if (!item.servico_id) {
    return (
      <p className="text-sm text-text-muted">
        {item.tipo === 'servico_grupo'
          ? 'Nenhuma composição vinculada. Vincule uma na aba Geral.'
          : 'Só os serviços têm composição. Agrupe a receita em um serviço para ver o custo.'}
      </p>
    )
  }
  if (isLoading) return <Carregando className="py-2" />
  if (error)
    return (
      <ErroConsulta erro={error} oQue="a composição" aoTentar={() => void refetch()} compacto />
    )
  if (!comp) {
    return <p className="text-sm text-text-muted">A composição vinculada não foi encontrada.</p>
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-text-muted">
        Valores da composição vigente. Mudanças em recursos e composições aparecem aqui na hora.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Custo unitário" value={fmtBRL4(comp.custo_unit ?? 0)} />
        <Metric
          label="Produção por dia"
          value={`${fmtQtd(comp.producao_diaria_qtde ?? 0)} ${comp.producao_diaria_unidade ?? ''}`}
        />
        <Metric label="Equipamento por dia" value={fmtBRL(comp.custo_eq_dia ?? 0)} />
        <Metric label="Combustível por dia" value={fmtBRL(comp.custo_comb_dia ?? 0)} />
        <Metric label="Mão de obra por dia" value={fmtBRL(comp.custo_mo_dia ?? 0)} />
        <Metric label="Material por dia" value={fmtBRL(comp.custo_mat_dia ?? 0)} />
      </div>

      <div>
        <h3 className={`${ROTULO} mb-1`}>Insumos</h3>
        {comp.itens.length === 0 ? (
          <p className="text-sm text-text-muted">A composição não tem insumos.</p>
        ) : (
          <div className="rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-bg-elevated">
                <tr className="border-b border-border-strong">
                  <th scope="col" className={`${ROTULO} text-left px-2 py-1.5`}>
                    Grupo
                  </th>
                  <th scope="col" className={`${ROTULO} text-left px-2 py-1.5`}>
                    Recurso
                  </th>
                  <th scope="col" className={`${ROTULO} text-right px-2 py-1.5`}>
                    Qtd.
                  </th>
                  <th scope="col" className={`${ROTULO} text-right px-2 py-1.5`}>
                    Custo/dia
                  </th>
                </tr>
              </thead>
              <tbody>
                {comp.itens.map((it) => (
                  <tr key={it.id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1 text-text-muted">{CPU_ITEM_GRUPO_LABEL[it.grupo]}</td>
                    <td
                      className="px-2 py-1 text-text truncate max-w-[180px]"
                      title={it.recurso?.nome}
                    >
                      {it.recurso?.nome ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-right tabular">
                      {Number(it.quantidade) ? fmtQtd(it.quantidade) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right tabular text-text">
                      {fmtBRL(it.custo_total_calc)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
