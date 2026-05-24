import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtBRL, fmtBRL4, fmtPct2, fmtQtd } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { useItemDetalhe, useSnapshotCpuNoItem, useUpsertItem } from '../hooks/plan-orc'
import { CPU_ITEM_GRUPO_LABEL } from '@/types/orcamento'
import { CommentsPanel } from './CommentsPanel'
import { MemoriaEditor } from './MemoriaEditor'
import { AnexosList } from './AnexosList'

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
  const upsert = useUpsertItem()
  const snapshot = useSnapshotCpuNoItem()

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
            onSave={(patch) =>
              upsert.mutateAsync({ id: item.id, obra_id: obraId, tipo: item.tipo, ...patch })
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
  onSave
}: {
  item: ReturnType<typeof useItemDetalhe>['data'] & object
  podeEditar: boolean
  onSave: (patch: Record<string, unknown>) => Promise<unknown>
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
  const [dirty, setDirty] = useState(false)
  const isReceita = item.tipo === 'receita'
  const isServicoGrupo = item.tipo === 'servico_grupo'

  const save = async (): Promise<void> => {
    const patch: Record<string, unknown> = { descricao: descricao.trim() }
    if (isReceita) {
      patch.unidade = unidade.trim() === '' ? null : unidade.trim()
      patch.quantidade = quantidade.trim() === '' ? null : Number(quantidade.replace(',', '.'))
      patch.venda_unitaria = vendaUnit.trim() === '' ? null : Number(vendaUnit.replace(',', '.'))
    } else if (isServicoGrupo) {
      patch.quantidade_referencia = qtdRef.trim() === '' ? null : Number(qtdRef.replace(',', '.'))
    }
    try {
      await onSave(patch)
      setDirty(false)
      toast.success('Item salvo.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
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
        <div>
          <Label>Serviço</Label>
          <div className="text-text-muted font-mono text-2xs">
            {item.servico ? `${item.servico.codigo} ${item.servico.nome}` : '—'}
          </div>
        </div>
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
        <div className="grid grid-cols-2 gap-3">
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
              disabled={!podeEditar || item.qtd_ref_modo !== 'manual'}
              placeholder={
                item.qtd_ref_modo === 'heranca'
                  ? 'auto: herdada de filho'
                  : item.qtd_ref_modo === 'soma_filhos'
                    ? 'auto: soma de filhos'
                    : ''
              }
            />
            <div className="text-2xs text-text-dim font-mono mt-1">
              Modo: {item.qtd_ref_modo ?? '—'}
            </div>
          </div>
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
          <Button size="sm" variant="default" onClick={save}>
            Salvar alterações
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
