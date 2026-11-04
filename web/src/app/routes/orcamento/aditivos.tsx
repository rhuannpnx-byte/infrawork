import { VoltarPlanilhaButton } from '@/features/orcamento/components/VoltarPlanilhaButton'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { FilePlus2, Minus, PackagePlus, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconButton } from '@/components/ui/IconButton'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import {
  useAditivos,
  useAditivoItens,
  useAplicarAditivo,
  useAtualizarAditivo,
  useCriarAditivo,
  useExcluirAditivo,
  useExcluirAditivoItem,
  useSalvarAditivoItem,
  type Aditivo,
  type AditivoItem
} from '@/features/orcamento/hooks/aditivos'
import { fmtBRL, fmtQtd, parseBR } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import type { ItemTreeNode } from '@/types/orcamento'

export function AditivosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Aditivos">
      <AditivosInner />
    </RequireObra>
  )
}

const hojeISO = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function AditivosInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const navigate = useNavigate()

  const { data: aditivos = [] } = useAditivos(obraId)
  const criar = useCriarAditivo()
  const [selId, setSelId] = useState<string | null>(null)
  const [novoOpen, setNovoOpen] = useState(false)
  const sel = aditivos.find((a) => a.id === selId) ?? aditivos[0] ?? null
  const temAplicado = aditivos.some((a) => a.status === 'aplicado')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Aditivos"
        breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Aditivos']}
        subtitle={`${scope.obra?.nome ?? ''} — acréscimos, supressões, exclusões e itens novos na planilha de venda`}
        actions={
          <div className="flex items-center gap-2">
            <VoltarPlanilhaButton />
            {temAplicado ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate({ to: '/orcamento/obra/planilha-inicial' })}
              >
                Planilha Inicial
              </Button>
            ) : null}
            {podeEditar ? (
              <Button size="sm" onClick={() => setNovoOpen(true)}>
                <Plus size={11} /> Novo aditivo
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-border overflow-auto p-3 space-y-2">
          {aditivos.length === 0 ? (
            <div className="text-xs text-text-muted">
              Nenhum aditivo. No primeiro aditivo aplicado, a planilha atual é arquivada como{' '}
              <strong>Planilha Inicial</strong>.
            </div>
          ) : (
            aditivos.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelId(a.id)}
                className={
                  'w-full text-left rounded border px-2.5 py-2 text-xs ' +
                  (sel?.id === a.id
                    ? 'border-accent-line bg-accent-glow'
                    : 'border-border hover:bg-bg-hover')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text">Aditivo {a.numero}</span>
                  <Badge variant={a.status === 'aplicado' ? 'success' : 'warn'}>
                    {a.status === 'aplicado' ? 'aplicado' : 'rascunho'}
                  </Badge>
                </div>
                <div className="text-2xs font-mono text-text-dim mt-0.5">{fmtDataBR(a.data)}</div>
                {a.descricao ? (
                  <div className="text-2xs text-text-muted truncate mt-0.5">{a.descricao}</div>
                ) : null}
                {a.status === 'aplicado' && a.venda_antes != null && a.venda_depois != null ? (
                  <div className="text-2xs font-mono mt-0.5 text-text-muted">
                    Δ venda {fmtBRL(a.venda_depois - a.venda_antes)}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </aside>
        <main className="flex-1 min-w-0 overflow-auto">
          {sel ? (
            <AditivoEditor key={sel.id} aditivo={sel} obraId={obraId} podeEditar={podeEditar} />
          ) : (
            <EmptyState
              icon="file-plus-2"
              title="Sem aditivo selecionado"
              description="Crie um aditivo para alterar quantidades, suprimir, excluir ou incluir itens na planilha de venda."
            />
          )}
        </main>
      </div>
      {novoOpen ? (
        <NovoAditivoDialog
          onClose={() => setNovoOpen(false)}
          onCriar={async (data, descricao) => {
            try {
              const r = await criar.mutateAsync({ obra_id: obraId, data, descricao })
              setSelId(r.id)
              setNovoOpen(false)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Falha ao criar aditivo')
            }
          }}
        />
      ) : null}
    </div>
  )
}

function NovoAditivoDialog({
  onClose,
  onCriar
}: {
  onClose: () => void
  onCriar: (data: string, descricao: string) => Promise<void>
}): ReactNode {
  const [data, setData] = useState(hojeISO())
  const [descricao, setDescricao] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm">
      <DialogHeader>
        <DialogTitle>Novo aditivo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div>
          <Label>Data do aditivo</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <Label>Descrição</Label>
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: adequação do transporte do CBUQ"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => void onCriar(data, descricao)} disabled={!data}>
          Criar rascunho
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

const TIPO_LABEL: Record<AditivoItem['tipo'], string> = {
  quantidade: 'Quantidade',
  exclusao: 'Exclusão',
  novo: 'Item novo'
}

function AditivoEditor({
  aditivo,
  obraId,
  podeEditar
}: {
  aditivo: Aditivo
  obraId: string
  podeEditar: boolean
}): ReactNode {
  const { data: itens = [] } = useAditivoItens(aditivo.id)
  const { data: plan } = usePlanOrc(obraId)
  const salvar = useSalvarAditivoItem()
  const excluirItem = useExcluirAditivoItem()
  const atualizar = useAtualizarAditivo()
  const excluir = useExcluirAditivo()
  const aplicar = useAplicarAditivo()
  const confirm = useConfirm()
  const [picker, setPicker] = useState<'quantidade' | 'exclusao' | null>(null)
  const [novoOpen, setNovoOpen] = useState(false)
  const rascunho = aditivo.status === 'rascunho'
  const editavel = podeEditar && rascunho

  const receitas = useMemo(() => (plan?.flat ?? []).filter((n) => n.tipo === 'receita'), [plan])
  const porId = useMemo(() => new Map(receitas.map((r) => [r.id, r])), [receitas])

  const deltaVenda = (it: AditivoItem): number => {
    if (it.tipo === 'novo') return (it.quantidade_nova ?? 0) * (it.venda_unitaria ?? 0)
    const r = it.receita_id ? porId.get(it.receita_id) : undefined
    const preco = Number(r?.venda_unitaria ?? it.venda_unitaria ?? 0)
    const antes = rascunho ? Number(r?.quantidade ?? 0) : Number(it.quantidade_antes ?? 0)
    if (it.tipo === 'exclusao') return -antes * preco
    return ((it.quantidade_nova ?? 0) - antes) * preco
  }
  const totalDelta = itens.reduce((a, it) => a + deltaVenda(it), 0)

  const adicionarReceita = async (
    r: ItemTreeNode,
    tipo: 'quantidade' | 'exclusao'
  ): Promise<void> => {
    if (tipo === 'exclusao' && (plan?.alocInfo.get(r.id)?.destinos.length ?? 0) > 0) {
      toast.error(`${r.codigo} está alocada em serviço — remova a alocação antes de excluir.`)
      return
    }
    try {
      await salvar.mutateAsync({
        aditivo_id: aditivo.id,
        tipo,
        receita_id: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        unidade: r.unidade,
        quantidade_antes: Number(r.quantidade ?? 0),
        quantidade_nova: tipo === 'quantidade' ? Number(r.quantidade ?? 0) : null,
        venda_unitaria: Number(r.venda_unitaria ?? 0),
        ordem: itens.length
      })
      setPicker(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha')
    }
  }

  const onAplicar = async (): Promise<void> => {
    const ok = await confirm({
      title: `Aplicar o aditivo ${aditivo.numero}?`,
      description:
        `A planilha de venda é alterada (Δ venda ${fmtBRL(totalDelta)}). ` +
        'No primeiro aditivo a planilha atual fica arquivada como Planilha Inicial e, daí em diante, a planilha de venda só muda por aditivo. ' +
        'Linhas de base passam a acusar "premissas mudaram". Não dá para desfazer.',
      confirmLabel: 'Aplicar aditivo'
    })
    if (!ok) return
    try {
      const r = await aplicar.mutateAsync({ id: aditivo.id })
      toast.success(
        `Aditivo ${r.numero} aplicado — venda ${fmtBRL(r.venda_antes)} → ${fmtBRL(r.venda_depois)}.${r.novos > 0 ? ' Itens novos sem serviço aparecem como saldo na planilha.' : ''}`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao aplicar')
    }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text">Aditivo {aditivo.numero}</h2>
            <Badge variant={rascunho ? 'warn' : 'success'}>
              {rascunho ? 'rascunho' : 'aplicado'}
            </Badge>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label>Data</Label>
              <Input
                type="date"
                className="w-40"
                defaultValue={aditivo.data}
                disabled={!editavel}
                onBlur={(e) =>
                  e.target.value !== aditivo.data &&
                  atualizar.mutate({ id: aditivo.id, data: e.target.value })
                }
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Descrição</Label>
              <Input
                defaultValue={aditivo.descricao ?? ''}
                disabled={!podeEditar}
                onBlur={(e) =>
                  e.target.value !== (aditivo.descricao ?? '') &&
                  atualizar.mutate({ id: aditivo.id, descricao: e.target.value || null })
                }
              />
            </div>
          </div>
        </div>
        {editavel ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `Excluir o rascunho do aditivo ${aditivo.numero}?`,
                  confirmLabel: 'Excluir',
                  variant: 'danger'
                })
                if (ok) excluir.mutate({ id: aditivo.id })
              }}
            >
              <Trash2 size={11} /> Excluir rascunho
            </Button>
            <Button
              size="sm"
              onClick={() => void onAplicar()}
              disabled={itens.length === 0 || aplicar.isPending}
            >
              <Play size={11} /> {aplicar.isPending ? 'Aplicando…' : 'Aplicar aditivo'}
            </Button>
          </div>
        ) : null}
      </div>

      {editavel ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onClick={() => setPicker('quantidade')}>
            <Pencil size={11} /> Acréscimo / supressão
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPicker('exclusao')}>
            <Minus size={11} /> Excluir item
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setNovoOpen(true)}>
            <PackagePlus size={11} /> Item novo
          </Button>
        </div>
      ) : null}

      <div className="rounded border border-border bg-bg-panel overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5">Tipo</th>
              <th className="text-left px-2 py-1.5">Código</th>
              <th className="text-left px-2 py-1.5">Descrição</th>
              <th className="text-left px-2 py-1.5">Un</th>
              <th className="text-right px-2 py-1.5">Qtd. atual</th>
              <th className="text-right px-2 py-1.5">Qtd. nova</th>
              <th className="text-right px-2 py-1.5">Preço</th>
              <th className="text-right px-2 py-1.5">Δ venda</th>
              <th className="px-2 py-1.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-text-muted">
                  Sem itens. Use os botões acima para montar o aditivo.
                </td>
              </tr>
            ) : (
              itens.map((it) => {
                const r = it.receita_id ? porId.get(it.receita_id) : undefined
                const atual = rascunho ? (r?.quantidade ?? null) : it.quantidade_antes
                const dv = deltaVenda(it)
                return (
                  <tr key={it.id} className="border-b border-border/40">
                    <td className="px-2 py-1.5">
                      <Badge
                        variant={
                          it.tipo === 'exclusao'
                            ? 'danger'
                            : it.tipo === 'novo'
                              ? 'accent'
                              : 'default'
                        }
                      >
                        {TIPO_LABEL[it.tipo]}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-mono">{it.codigo}</td>
                    <td className="px-2 py-1.5 text-text">
                      {it.descricao}
                      {it.tipo === 'novo' && it.alocacao?.destinos?.[0] ? (
                        <div className="text-2xs text-text-dim font-mono">
                          → {it.alocacao.destinos[0].servico ?? 'serviço existente'}
                          {it.alocacao.compoe ? ' · compõe a quantidade' : ''}
                        </div>
                      ) : it.tipo === 'novo' ? (
                        <div className="text-2xs text-warn font-mono">
                          sem serviço — entra como saldo
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-text-muted">{it.unidade ?? ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                      {atual != null ? fmtQtd(atual) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {it.tipo === 'quantidade' && editavel ? (
                        <Input
                          className="h-6 w-28 text-right ml-auto"
                          defaultValue={
                            it.quantidade_nova != null ? fmtQtd(it.quantidade_nova) : ''
                          }
                          onBlur={(e) => {
                            const v = parseBR(e.target.value).toNumber()
                            if (!Number.isFinite(v) || v === it.quantidade_nova) return
                            salvar.mutate({ ...it, quantidade_nova: v })
                          }}
                        />
                      ) : it.tipo === 'exclusao' ? (
                        <span className="text-danger">0</span>
                      ) : it.quantidade_nova != null ? (
                        fmtQtd(it.quantidade_nova)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {it.venda_unitaria != null ? fmtBRL(it.venda_unitaria) : '—'}
                    </td>
                    <td
                      className={
                        'px-2 py-1.5 text-right tabular-nums ' +
                        (dv < 0 ? 'text-danger' : dv > 0 ? 'text-success' : 'text-text-muted')
                      }
                    >
                      {fmtBRL(dv)}
                    </td>
                    <td className="px-2 py-1.5">
                      {editavel ? (
                        <IconButton
                          size="sm"
                          variant="danger"
                          aria-label="Remover linha"
                          onClick={() => excluirItem.mutate({ id: it.id, aditivo_id: aditivo.id })}
                        >
                          <Trash2 size={11} />
                        </IconButton>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          {itens.length > 0 ? (
            <tfoot>
              <tr className="bg-bg font-mono text-2xs">
                <td colSpan={7} className="px-2 py-1.5 text-right text-text-dim uppercase">
                  Δ venda do aditivo
                </td>
                <td
                  className={
                    'px-2 py-1.5 text-right tabular-nums font-semibold ' +
                    (totalDelta < 0 ? 'text-danger' : 'text-success')
                  }
                >
                  {fmtBRL(totalDelta)}
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="text-2xs text-text-dim">
        Supressão: só é recusada se a quantidade do serviço ficar abaixo do já executado. Exclusão:
        só de receita sem alocação. Itens novos sem serviço aparecem como saldo na barra de
        progresso da planilha e podem ser agrupados/rateados depois, mesmo com plano vigente.
      </p>

      {picker ? (
        <ReceitaPicker
          titulo={picker === 'quantidade' ? 'Acréscimo / supressão' : 'Excluir item'}
          receitas={receitas}
          bloqueadas={
            picker === 'exclusao'
              ? new Set(
                  receitas
                    .filter((r) => (plan?.alocInfo.get(r.id)?.destinos.length ?? 0) > 0)
                    .map((r) => r.id)
                )
              : new Set()
          }
          jaNoAditivo={new Set(itens.map((i) => i.receita_id).filter((x): x is string => !!x))}
          onPick={(r) => void adicionarReceita(r, picker)}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {novoOpen ? (
        <ItemNovoDialog
          servicos={(plan?.servicos ?? []).map((s) => ({
            id: s.id,
            nome: s.descricao,
            codigo: s.codigo
          }))}
          onClose={() => setNovoOpen(false)}
          onSalvar={async (v) => {
            try {
              await salvar.mutateAsync({
                aditivo_id: aditivo.id,
                tipo: 'novo',
                ordem: itens.length,
                ...v
              })
              setNovoOpen(false)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Falha')
            }
          }}
        />
      ) : null}
    </div>
  )
}

function ReceitaPicker({
  titulo,
  receitas,
  bloqueadas,
  jaNoAditivo,
  onPick,
  onClose
}: {
  titulo: string
  receitas: ItemTreeNode[]
  bloqueadas: Set<string>
  jaNoAditivo: Set<string>
  onPick: (r: ItemTreeNode) => void
  onClose: () => void
}): ReactNode {
  const [busca, setBusca] = useState('')
  const lista = receitas
    .filter((r) => !jaNoAditivo.has(r.id))
    .filter((r) => {
      const b = busca.trim().toLowerCase()
      return !b || r.codigo.toLowerCase().includes(b) || r.descricao.toLowerCase().includes(b)
    })
    .slice(0, 200)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>{titulo} — escolha a receita</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-2">
        <Input
          autoFocus
          placeholder="Buscar por código ou descrição"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="max-h-[50vh] overflow-auto rounded border border-border">
          {lista.map((r) => {
            const bloq = bloqueadas.has(r.id)
            return (
              <button
                key={r.id}
                type="button"
                disabled={bloq}
                onClick={() => onPick(r)}
                title={bloq ? 'Alocada em serviço — remova a alocação antes de excluir' : undefined}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left border-b border-border/40 hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="font-mono text-text-dim w-16 shrink-0">{r.codigo}</span>
                <span className="flex-1 truncate text-text">{r.descricao}</span>
                <span className="font-mono text-text-muted tabular-nums">
                  {fmtQtd(r.quantidade ?? 0)} {r.unidade}
                </span>
              </button>
            )
          })}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ItemNovoDialog({
  servicos,
  onClose,
  onSalvar
}: {
  servicos: Array<{ id: string; nome: string; codigo: string }>
  onClose: () => void
  onSalvar: (v: Partial<AditivoItem> & { codigo: string }) => Promise<void>
}): ReactNode {
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('')
  const [qtd, setQtd] = useState('')
  const [preco, setPreco] = useState('')
  const [servico, setServico] = useState('')
  const [compoe, setCompoe] = useState(true)
  const etapa = !unidade.trim() && !qtd.trim()
  const valido =
    /^[0-9]+(\.[0-9]+)*$/.test(codigo.trim()) &&
    descricao.trim() &&
    (etapa || (unidade.trim() && qtd.trim() && preco.trim()))
  const existente = servicos.find((s) => s.nome.toLowerCase() === servico.trim().toLowerCase())
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>Item novo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="grid grid-cols-[110px_1fr] gap-2">
          <div>
            <Label>Código</Label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="02.09" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Unidade</Label>
            <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="m³" />
          </div>
          <div>
            <Label>Quantidade</Label>
            <Input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <Label>Preço unitário</Label>
            <Input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" />
          </div>
        </div>
        <p className="text-2xs text-text-dim">
          Sem unidade e quantidade, o item entra como etapa (título). O item pai é o prefixo do
          código.
        </p>
        {!etapa ? (
          <div className="rounded border border-border p-2.5 space-y-2">
            <Label>Serviço (opcional)</Label>
            <Input
              list="aditivo-servicos"
              value={servico}
              onChange={(e) => setServico(e.target.value)}
              placeholder="Escolha um serviço ou digite o nome de um novo — vazio = saldo"
            />
            <datalist id="aditivo-servicos">
              {servicos.map((s) => (
                <option key={s.id} value={s.nome}>
                  {s.codigo}
                </option>
              ))}
            </datalist>
            {servico.trim() ? (
              <div className="text-2xs text-text-dim">
                {existente
                  ? `Vai para o serviço existente ${existente.codigo}.`
                  : 'Cria um serviço novo (sem composição).'}
              </div>
            ) : null}
            {servico.trim() ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={compoe}
                  onChange={(e) => setCompoe(e.target.checked)}
                />
                Compõe a quantidade do serviço
              </label>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={!valido}
          onClick={() =>
            void onSalvar({
              codigo: codigo.trim(),
              descricao: descricao.trim(),
              unidade: etapa ? null : unidade.trim(),
              quantidade_nova: etapa ? null : parseBR(qtd).toNumber(),
              venda_unitaria: etapa ? null : parseBR(preco).toNumber(),
              alocacao:
                !etapa && servico.trim()
                  ? {
                      criterio: 'percentual',
                      compoe,
                      destinos: [
                        existente
                          ? { grupo_id: existente.id, servico: existente.nome, valor: 100 }
                          : { servico: servico.trim(), valor: 100 }
                      ]
                    }
                  : null
            })
          }
        >
          <FilePlus2 size={11} /> Incluir no aditivo
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
