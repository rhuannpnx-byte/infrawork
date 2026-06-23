import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { fmtBRL, fmtBRL4, fmtPct2, fmtQtd, parseBR } from '@/lib/money'
import { formatDate } from '@/lib/format'
import {
  useItemDetalhe,
  usePlanOrc,
  useSnapshotCpuNoItem,
  useUpsertItem,
  useAtualizarAgrupador,
  type AtualizarAgrupadorInput
} from '../hooks/plan-orc'
import { useServicos } from '../hooks/servicos'
import { CPU_ITEM_GRUPO_LABEL, type QtdRefModo } from '@/types/orcamento'
import { CommentsPanel } from './CommentsPanel'
import { MemoriaEditor } from './MemoriaEditor'
import { AnexosList } from './AnexosList'

/** Filho (receita) de um agrupador, para o seletor de referência de quantidade. */
interface FilhoRef {
  id: string
  codigo: string
  descricao: string
  quantidade: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string | null
  obraId: string
  podeEditar: boolean
}

type Tab = 'geral' | 'cpu' | 'comentarios' | 'memoria' | 'anexos'

const TAB_LABELS: Record<Tab, string> = {
  geral: 'Geral',
  cpu: 'CPU',
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
  const snapshot = useSnapshotCpuNoItem()

  const servicosFolha = useMemo(() => servicos.filter((s) => s.unidade !== null), [servicos])
  // Receitas filhas do agrupador atual (para o seletor de herança/soma).
  const filhos = useMemo<FilhoRef[]>(() => {
    if (!item || item.tipo !== 'servico_grupo') return []
    return (plan?.flat ?? [])
      .filter((n) => n.parent_id === item.id && n.tipo === 'receita')
      .map((n) => ({
        id: n.id,
        codigo: n.codigo,
        descricao: n.descricao,
        quantidade: n.quantidade ?? 0
      }))
  }, [plan, item])

  if (!open) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
        ) : tab === 'geral' ? (
          <GeralTab
            item={item}
            podeEditar={podeEditar}
            servicosFolha={servicosFolha}
            filhos={filhos}
            onSave={(patch) =>
              upsert.mutateAsync({ id: item.id, obra_id: obraId, tipo: item.tipo, ...patch })
            }
            onSaveAgrupador={(input) =>
              atualizarAgrupador.mutateAsync({ ...input, id: item.id, obra_id: obraId })
            }
          />
        ) : tab === 'cpu' ? (
          <CpuTab
            item={item}
            obraId={obraId}
            podeEditar={podeEditar}
            onReaplicar={async () => {
              try {
                await snapshot.mutateAsync({ item_id: item.id, obra_id: obraId, force: true })
                toast.success('CPU vigente reaplicada.')
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Falha ao reaplicar')
              }
            }}
            reaplicando={snapshot.isPending}
          />
        ) : tab === 'comentarios' ? (
          <CommentsPanel itemId={item.id} />
        ) : tab === 'memoria' ? (
          <MemoriaEditor itemId={item.id} podeEditar={podeEditar} />
        ) : (
          <AnexosList obraId={obraId} escopo="item" escopoId={item.id} podeEditar={podeEditar} />
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

function GeralTab({
  item,
  podeEditar,
  servicosFolha,
  filhos,
  onSave,
  onSaveAgrupador
}: {
  item: ReturnType<typeof useItemDetalhe>['data'] & object
  podeEditar: boolean
  servicosFolha: { id: string; codigo: string; nome: string; unidade: string | null }[]
  filhos: FilhoRef[]
  onSave: (patch: Record<string, unknown>) => Promise<unknown>
  onSaveAgrupador: (input: Omit<AtualizarAgrupadorInput, 'id' | 'obra_id'>) => Promise<unknown>
}): ReactNode {
  const [descricao, setDescricao] = useState(item.descricao)
  const [unidade, setUnidade] = useState(item.unidade ?? '')
  const [quantidade, setQuantidade] = useState(
    item.quantidade !== null ? String(item.quantidade) : ''
  )
  const [vendaUnit, setVendaUnit] = useState(
    item.venda_unitaria !== null ? String(item.venda_unitaria) : ''
  )
  const [qtdRef, setQtdRef] = useState(
    item.quantidade_referencia !== null ? String(item.quantidade_referencia) : ''
  )
  const [qtdRefModo, setQtdRefModo] = useState<QtdRefModo>(item.qtd_ref_modo ?? 'manual')
  const [unidadeRef, setUnidadeRef] = useState<string>(item.unidade_referencia ?? '')
  const [servicoId, setServicoId] = useState<string>(item.servico_id ?? '')
  const [filhosRef, setFilhosRef] = useState<Set<string>>(new Set(item.qtd_ref_filhos ?? []))
  const [dirty, setDirty] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const isReceita = item.tipo === 'receita'
  const isServicoGrupo = item.tipo === 'servico_grupo'
  const ehIndireto = !!item.indireto_id

  const childQty = new Map(filhos.map((f) => [f.id, f.quantidade]))
  const filhosValidos = Array.from(filhosRef).filter((id) => childQty.has(id))
  const herancaSel = filhosValidos[0] ?? filhos[0]?.id ?? null

  // Quantidade de referência conforme o modo e os filhos escolhidos.
  const qtdCalc = ((): number => {
    if (qtdRefModo === 'manual') return parseBR(qtdRef).toNumber() || 0
    if (qtdRefModo === 'heranca') return herancaSel ? (childQty.get(herancaSel) ?? 0) : 0
    return filhosValidos.reduce((acc, id) => acc + (childQty.get(id) ?? 0), 0)
  })()

  const trocarModo = (m: QtdRefModo): void => {
    setQtdRefModo(m)
    setDirty(true)
    if (m === 'soma_filhos') setFilhosRef(new Set(filhos.map((f) => f.id)))
    else if (m === 'heranca') {
      const atual = Array.from(filhosRef).find((id) => childQty.has(id)) ?? filhos[0]?.id
      setFilhosRef(new Set(atual ? [atual] : []))
    }
  }

  const escolherHeranca = (id: string): void => {
    setFilhosRef(new Set([id]))
    setDirty(true)
  }

  const toggleSoma = (id: string): void => {
    setFilhosRef((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    setDirty(true)
  }

  const trocarServico = (id: string): void => {
    setServicoId(id)
    setDirty(true)
    // Espelha a unidade do serviço escolhido na unidade de referência.
    const s = servicosFolha.find((x) => x.id === id)
    if (s?.unidade) setUnidadeRef(s.unidade)
  }

  const save = async (): Promise<void> => {
    setSalvando(true)
    try {
      if (isServicoGrupo) {
        if (qtdCalc <= 0) {
          toast.error(
            'Quantidade de referência deve ser > 0 (escolha os filhos ou o valor manual).'
          )
          return
        }
        const novoServico = ehIndireto ? null : servicoId || null
        const refFilhos =
          qtdRefModo === 'manual'
            ? []
            : qtdRefModo === 'heranca'
              ? herancaSel
                ? [herancaSel]
                : []
              : filhosValidos
        await onSaveAgrupador({
          descricao: descricao.trim(),
          servico_id: novoServico,
          servico_mudou: !ehIndireto && novoServico !== (item.servico_id ?? null),
          unidade_referencia: unidadeRef.trim() || item.unidade_referencia || 'un',
          qtd_ref_modo: qtdRefModo,
          quantidade_referencia: qtdCalc,
          qtd_ref_filhos: refFilhos
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
            {item.tipo === 'etapa'
              ? 'Índice'
              : item.tipo === 'servico_grupo'
                ? 'Grupo de serviço'
                : 'Receita'}
          </div>
        </div>
        <div>
          <Label htmlFor="g-un">Unidade</Label>
          {isReceita ? (
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
          ) : (
            <div className="text-text font-mono">
              {isServicoGrupo ? (item.unidade_referencia ?? '—') : '—'}
            </div>
          )}
        </div>
        {!isServicoGrupo ? (
          <div>
            <Label>Serviço</Label>
            <div className="text-text-muted font-mono text-2xs">
              {item.servico ? `${item.servico.codigo} ${item.servico.nome}` : '—'}
            </div>
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
            <Label htmlFor="g-vu">Venda unit. (com BDI)</Label>
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
          {/* Serviço de custo (editável para grupos baseados em CPU) */}
          {ehIndireto ? (
            <div>
              <Label>Vínculo</Label>
              <div className="text-text-muted font-mono text-2xs">
                Custo vindo de item de indireto
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="g-servico">Serviço de custo</Label>
              <Select
                id="g-servico"
                value={servicoId}
                onChange={(e) => trocarServico(e.target.value)}
                disabled={!podeEditar}
              >
                <option value="">— sem serviço —</option>
                {servicosFolha.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} · {s.nome} ({s.unidade})
                  </option>
                ))}
              </Select>
              {servicoId && servicoId !== (item.servico_id ?? '') ? (
                <p className="text-2xs font-mono text-warn mt-0.5">
                  O snapshot da CPU será regerado do serviço escolhido ao salvar.
                </p>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-qtdrefmodo">Modo de quantidade de referência</Label>
              <select
                id="g-qtdrefmodo"
                value={qtdRefModo}
                onChange={(e) => trocarModo(e.target.value as QtdRefModo)}
                disabled={!podeEditar}
                className="w-full h-8 px-2 bg-bg border border-border rounded text-xs text-text font-mono focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="manual">manual — digito o número</option>
                <option value="heranca">herança — herda de um filho</option>
                <option value="soma_filhos">soma — soma dos filhos marcados</option>
              </select>
            </div>
            <div>
              <Label htmlFor="g-unref">Unidade de referência</Label>
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

          {/* Quantidade: input manual OU valor calculado dos filhos */}
          {qtdRefModo === 'manual' ? (
            <div>
              <Label htmlFor="g-qtdref">Quantidade de referência</Label>
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
            <div>
              <Label>
                {qtdRefModo === 'heranca'
                  ? 'Herda a quantidade do filho marcado'
                  : `Soma dos filhos marcados (${filhosValidos.length}/${filhos.length})`}
              </Label>
              {filhos.length === 0 ? (
                <div className="text-2xs font-mono text-text-dim">
                  Sem receitas filhas neste grupo.
                </div>
              ) : (
                <div className="rounded border border-border divide-y divide-border">
                  {filhos.map((f) => {
                    const marcado =
                      qtdRefModo === 'heranca' ? herancaSel === f.id : filhosRef.has(f.id)
                    return (
                      <label
                        key={f.id}
                        className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-bg-hover"
                      >
                        <input
                          type={qtdRefModo === 'heranca' ? 'radio' : 'checkbox'}
                          name={`filho-${item.id}`}
                          checked={marcado}
                          onChange={() =>
                            qtdRefModo === 'heranca' ? escolherHeranca(f.id) : toggleSoma(f.id)
                          }
                          disabled={!podeEditar}
                          className="shrink-0 accent-[color:var(--accent)] cursor-pointer"
                        />
                        <span className="text-text-muted font-mono w-16 truncate shrink-0">
                          {f.codigo}
                        </span>
                        <span className="text-text flex-1 truncate">{f.descricao}</span>
                        <span className="text-2xs font-mono text-text-dim shrink-0 tabular-nums">
                          {fmtQtd(f.quantidade)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="text-2xs font-mono text-text-dim mt-1">
                Quantidade calculada: <span className="text-text">{fmtQtd(qtdCalc)}</span>{' '}
                {unidadeRef || item.unidade_referencia || ''}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="border-t border-border pt-2 grid grid-cols-2 gap-3 font-mono">
        <Metric
          label="Custo unitário"
          value={item.custo_unitario_calc !== null ? fmtBRL4(item.custo_unitario_calc) : '—'}
        />
        <Metric label="Custo total" value={fmtBRL(item.custo_total_calc)} />
        <Metric label="Venda total" value={fmtBRL(item.venda_total_calc)} />
        <Metric
          label="Lucratividade"
          value={
            item.lucratividade_perc_calc !== null ? fmtPct2(item.lucratividade_perc_calc) : '—'
          }
        />
      </div>

      {podeEditar && dirty ? (
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="default" onClick={save} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </Button>
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

function CpuTab({
  item,
  podeEditar,
  onReaplicar,
  reaplicando
}: {
  item: ReturnType<typeof useItemDetalhe>['data'] & object
  obraId: string
  podeEditar: boolean
  onReaplicar: () => Promise<void>
  reaplicando: boolean
}): ReactNode {
  const snap = item.cpu_snapshot
  if (!snap) {
    return (
      <div className="text-xs text-text-muted font-mono">
        Nenhuma CPU vinculada. Vincule um serviço com CPU vigente para gerar snapshot.
        {podeEditar && item.servico_id ? (
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            onClick={onReaplicar}
            disabled={reaplicando}
          >
            <RefreshCw size={11} /> {reaplicando ? 'Gerando…' : 'Gerar snapshot da CPU vigente'}
          </Button>
        ) : null}
      </div>
    )
  }
  // Detecta drift: se algum preço vigente do payload != preço atual no recurso (best effort)
  const itensPayload = snap.payload?.itens ?? []
  const drift = itensPayload.some((it) => {
    const atual = it.preco_vigente
    return atual !== null && Math.abs(Number(atual) - Number(it.preco_vigente)) > 0.001
  })

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="success">v{snap.versao_origem}</Badge>
          <span className="text-text-muted font-mono">
            Snapshot em {formatDate(snap.snapshot_em)}
          </span>
        </div>
        {podeEditar ? (
          <Button variant="secondary" size="sm" onClick={onReaplicar} disabled={reaplicando}>
            <RefreshCw size={11} /> {reaplicando ? 'Reaplicando…' : 'Reaplicar vigente'}
          </Button>
        ) : null}
      </div>

      {drift ? (
        <div className="flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-2xs font-mono text-warn">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>Preços de recursos mudaram após o snapshot. Reaplique para atualizar.</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 font-mono">
        <Metric label="Custo unit." value={fmtBRL4(snap.custo_unit)} />
        <Metric
          label="Produção/dia"
          value={`${fmtQtd(snap.producao_diaria_qtde)} ${snap.producao_diaria_unidade}`}
        />
        <Metric label="EQ/dia" value={fmtBRL(snap.custo_eq_dia)} />
        <Metric label="Comb/dia" value={fmtBRL(snap.custo_comb_dia)} />
        <Metric label="MO/dia" value={fmtBRL(snap.custo_mo_dia)} />
        <Metric label="Mat/dia" value={fmtBRL(snap.custo_mat_dia)} />
      </div>

      <div>
        <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">
          Itens da CPU
        </div>
        <div className="rounded border border-border">
          <table className="w-full text-2xs font-mono">
            <thead className="text-text-dim">
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1">Grupo</th>
                <th className="text-left px-2 py-1">Recurso</th>
                <th className="text-right px-2 py-1">Qtd</th>
                <th className="text-right px-2 py-1">Preço vig.</th>
                <th className="text-right px-2 py-1">Custo</th>
              </tr>
            </thead>
            <tbody>
              {itensPayload.map((it) => (
                <tr key={it.id} className="border-b border-border/40">
                  <td className="px-2 py-1 text-text-dim">{CPU_ITEM_GRUPO_LABEL[it.grupo]}</td>
                  <td
                    className="px-2 py-1 text-text truncate max-w-[160px]"
                    title={it.recurso?.nome}
                  >
                    {it.recurso?.nome ?? '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtQtd(it.quantidade)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {it.preco_vigente !== null ? fmtBRL4(it.preco_vigente) : '—'}
                  </td>
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
