import { VoltarPlanilhaButton } from '@/features/orcamento/components/VoltarPlanilhaButton'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Play, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { contar, rotuloReajusteStatus } from '@/lib/rotulos'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { IconButton } from '@/components/ui/IconButton'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import {
  useAplicarReajuste,
  useAtualizarReajuste,
  useClassificar,
  useCriarReajuste,
  useDataBase,
  useDefinirDataBase,
  useExcluirGrupo,
  useExcluirReajuste,
  useReajusteDetalhe,
  useReajustes,
  useSalvarGrupo,
  type Reajuste
} from '@/features/orcamento/hooks/reajustes'
import { fmtBRL, fmtPct2, fmtQtd, parseBR } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'

export function ReajustesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Reajustes">
      <ReajustesInner />
    </RequireObra>
  )
}

const somaMeses = (iso: string, meses: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1 + meses, d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function ReajustesInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const { data: reajustes = [] } = useReajustes(obraId)
  const { data: dataBase } = useDataBase(obraId)
  const definirBase = useDefinirDataBase()
  const criar = useCriarReajuste()
  const [selId, setSelId] = useState<string | null>(null)
  const [novoOpen, setNovoOpen] = useState(false)
  const sel = reajustes.find((r) => r.id === selId) ?? reajustes[0] ?? null
  const aplicados = reajustes.filter((r) => r.status === 'aplicado')
  const ultimo = aplicados[0] ?? null
  const proximaData = ultimo
    ? somaMeses(ultimo.data, 12)
    : dataBase
      ? somaMeses(dataBase, 12)
      : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Reajustes"
        breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Reajustes']}
        subtitle="Reajuste anual por grupos de índices, válido a partir da data informada"
        actions={
          <div className="flex items-center gap-2">
            <VoltarPlanilhaButton />
            {podeEditar ? (
              <Button size="sm" onClick={() => setNovoOpen(true)} disabled={!dataBase}>
                <Plus size={12} /> Novo reajuste
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="px-5 py-2 border-b border-border flex items-end gap-4 flex-wrap text-xs">
        <div>
          <Label>Data-base do orçamento</Label>
          <Input
            type="date"
            className="w-40"
            defaultValue={dataBase ?? ''}
            key={dataBase ?? 'vazia'}
            disabled={!podeEditar || aplicados.length > 0}
            onBlur={(e) => {
              if (!e.target.value || e.target.value === dataBase) return
              definirBase.mutate(
                { obra_id: obraId, data: e.target.value },
                { onError: (err) => toast.error(err.message) }
              )
            }}
          />
        </div>
        <div className="text-text-muted pb-1.5">
          {!dataBase
            ? 'Defina a data-base para lançar o 1º reajuste.'
            : proximaData
              ? `Próximo reajuste a partir de ${fmtDataBR(proximaData)} (12 meses ${ultimo ? `do reajuste ${ultimo.numero}` : 'da data-base'}).`
              : null}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex">
        <aside className="w-60 shrink-0 border-r border-border overflow-auto p-3 space-y-2">
          {reajustes.length === 0 ? (
            <div className="text-xs text-text-muted">Nenhum reajuste.</div>
          ) : (
            reajustes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelId(r.id)}
                className={
                  'w-full text-left rounded border px-2.5 py-2 text-xs ' +
                  (sel?.id === r.id
                    ? 'border-accent-line bg-accent-glow'
                    : 'border-border hover:bg-bg-hover')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text">Reajuste {r.numero}</span>
                  <Badge variant={r.status === 'aplicado' ? 'success' : 'warn'}>
                    {rotuloReajusteStatus(r.status)}
                  </Badge>
                </div>
                <div className="text-2xs font-mono text-text-dim mt-0.5">{fmtDataBR(r.data)}</div>
                {r.status === 'aplicado' && r.venda_antes != null && r.venda_depois != null ? (
                  <div className="text-2xs font-mono text-text-muted mt-0.5">
                    Δ venda {fmtBRL(r.venda_depois - r.venda_antes)}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </aside>
        <main className="flex-1 min-w-0 overflow-auto">
          {sel ? (
            <ReajusteEditor
              key={sel.id}
              reajuste={sel}
              obraId={obraId}
              podeEditar={podeEditar}
              proximaData={sel.status === 'rascunho' ? proximaData : null}
            />
          ) : (
            <EmptyState
              icon="percent"
              title="Sem reajuste"
              description="Crie os grupos de índices, classifique as receitas e aplique na data do reajuste."
            />
          )}
        </main>
      </div>
      {novoOpen ? (
        <NovoReajusteDialog
          dataSugerida={proximaData}
          anterior={ultimo}
          onClose={() => setNovoOpen(false)}
          onCriar={async (data, descricao, copiar) => {
            try {
              const r = await criar.mutateAsync({
                obra_id: obraId,
                data,
                descricao,
                copiarDe: copiar ? (ultimo?.id ?? null) : null
              })
              setSelId(r.id)
              setNovoOpen(false)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Falha ao criar reajuste')
            }
          }}
        />
      ) : null}
    </div>
  )
}

function NovoReajusteDialog({
  dataSugerida,
  anterior,
  onClose,
  onCriar
}: {
  dataSugerida: string | null
  anterior: Reajuste | null
  onClose: () => void
  onCriar: (data: string, descricao: string, copiar: boolean) => Promise<void>
}): ReactNode {
  const [data, setData] = useState(dataSugerida ?? '')
  const [descricao, setDescricao] = useState('')
  const [copiar, setCopiar] = useState(!!anterior)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm">
      <DialogHeader>
        <DialogTitle>Novo reajuste</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div>
          <Label>Data do reajuste (a partir de quando vale)</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <Label>Descrição</Label>
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: 1º reajuste anual"
          />
        </div>
        {anterior ? (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={copiar}
              onChange={(e) => setCopiar(e.target.checked)}
            />
            <span>
              Copiar grupos e classificação do reajuste {anterior.numero} (o índice anterior de cada
              grupo vira o índice atual daquele reajuste)
            </span>
          </label>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => void onCriar(data, descricao, copiar)} disabled={!data}>
          Criar rascunho
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ReajusteEditor({
  reajuste,
  obraId,
  podeEditar,
  proximaData
}: {
  reajuste: Reajuste
  obraId: string
  podeEditar: boolean
  proximaData: string | null
}): ReactNode {
  const { data: det } = useReajusteDetalhe(reajuste.id)
  const { data: plan } = usePlanOrc(obraId)
  const salvarGrupo = useSalvarGrupo()
  const excluirGrupo = useExcluirGrupo()
  const classificar = useClassificar()
  const atualizar = useAtualizarReajuste()
  const excluir = useExcluirReajuste()
  const aplicar = useAplicarReajuste()
  const confirm = useConfirm()
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [soSem, setSoSem] = useState(false)
  const rascunho = reajuste.status === 'rascunho'
  const editavel = podeEditar && rascunho
  const grupos = det?.grupos ?? []
  const itens = det?.itens ?? []
  const grupoDe = useMemo(() => new Map(itens.map((i) => [i.receita_id, i.grupo_id])), [itens])
  const itemDe = useMemo(() => new Map(itens.map((i) => [i.receita_id, i])), [itens])
  const fatorDe = useMemo(
    () => new Map(grupos.map((g) => [g.id, g.indice_atual / g.indice_anterior])),
    [grupos]
  )
  const linhas = (plan?.flat ?? []).filter(
    (n) => n.tipo === 'etapa' || !soSem || !grupoDe.has(n.id)
  )

  const deltaVenda = (plan?.flat ?? [])
    .filter((n) => n.tipo === 'receita' && grupoDe.has(n.id))
    .reduce((a, n) => {
      if (!rascunho) {
        const it = itemDe.get(n.id)
        return a + ((it?.preco_depois ?? 0) - (it?.preco_antes ?? 0)) * Number(n.quantidade ?? 0)
      }
      const f = fatorDe.get(grupoDe.get(n.id)!) ?? 1
      const p = Number(n.venda_unitaria ?? 0)
      return a + (Math.round(p * f * 100) / 100 - p) * Number(n.quantidade ?? 0)
    }, 0)

  const marcarEtapa = (codigo: string): void => {
    const ids = (plan?.flat ?? [])
      .filter((n) => n.tipo === 'receita' && n.codigo.startsWith(codigo + '.'))
      .map((n) => n.id)
    setSelecionadas((s) => {
      const nx = new Set(s)
      const todas = ids.every((id) => nx.has(id))
      for (const id of ids) {
        if (todas) nx.delete(id)
        else nx.add(id)
      }
      return nx
    })
  }

  const onAplicar = async (): Promise<void> => {
    const semGrupo = (plan?.flat ?? []).filter(
      (n) => n.tipo === 'receita' && !grupoDe.has(n.id)
    ).length
    const ok = await confirm({
      title: `Aplicar o reajuste ${reajuste.numero} em ${fmtDataBR(reajuste.data)}?`,
      description:
        `Os preços de venda das ${itens.length} receitas classificadas mudam (Δ venda ${fmtBRL(deltaVenda)}).` +
        (semGrupo > 0
          ? ` ${contar(semGrupo, 'receita sem grupo fica', 'receitas sem grupo ficam')} sem reajuste.`
          : '') +
        ' O que foi executado/planejado antes da data continua valorado pelo preço anterior. Não dá para desfazer.',
      confirmLabel: 'Aplicar reajuste'
    })
    if (!ok) return
    try {
      const r = await aplicar.mutateAsync({ id: reajuste.id })
      toast.success(
        `Reajuste ${r.numero} aplicado — venda ${fmtBRL(r.venda_antes)} → ${fmtBRL(r.venda_depois)}.`
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
            <h2 className="text-lg font-semibold text-text">Reajuste {reajuste.numero}</h2>
            <Badge variant={rascunho ? 'warn' : 'success'}>
              {rotuloReajusteStatus(reajuste.status)}
            </Badge>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label>Data</Label>
              <Input
                type="date"
                className="w-40"
                defaultValue={reajuste.data}
                disabled={!editavel}
                onBlur={(e) =>
                  e.target.value !== reajuste.data &&
                  atualizar.mutate({ id: reajuste.id, data: e.target.value })
                }
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Descrição</Label>
              <Input
                defaultValue={reajuste.descricao ?? ''}
                disabled={!podeEditar}
                onBlur={(e) =>
                  e.target.value !== (reajuste.descricao ?? '') &&
                  atualizar.mutate({ id: reajuste.id, descricao: e.target.value || null })
                }
              />
            </div>
          </div>
          {rascunho && proximaData && reajuste.data < proximaData ? (
            <div className="text-2xs text-warn">
              A data precisa ser a partir de {fmtDataBR(proximaData)} (intervalo de 12 meses).
            </div>
          ) : null}
        </div>
        {editavel ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `Excluir o rascunho do reajuste ${reajuste.numero}?`,
                  confirmLabel: 'Excluir',
                  variant: 'danger'
                })
                if (ok) excluir.mutate({ id: reajuste.id })
              }}
            >
              <Trash2 size={12} /> Excluir rascunho
            </Button>
            <Button
              size="sm"
              onClick={() => void onAplicar()}
              disabled={itens.length === 0 || aplicar.isPending}
            >
              <Play size={12} /> {aplicar.isPending ? 'Aplicando…' : 'Aplicar reajuste'}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Grupos */}
      <section>
        <h3 className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1.5">
          Grupos de índices
        </h3>
        <div className="rounded border border-border bg-bg-panel overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1.5">Grupo</th>
                <th className="text-right px-2 py-1.5">Índice anterior</th>
                <th className="text-right px-2 py-1.5">Índice atual</th>
                <th className="text-right px-2 py-1.5">Reajuste</th>
                <th className="text-right px-2 py-1.5">Receitas</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.id} className="border-b border-border">
                  <td className="px-2 py-1">
                    <Input
                      className="h-6"
                      defaultValue={g.nome}
                      disabled={!editavel}
                      onBlur={(e) =>
                        e.target.value.trim() &&
                        e.target.value !== g.nome &&
                        salvarGrupo.mutate({
                          id: g.id,
                          reajuste_id: reajuste.id,
                          nome: e.target.value.trim()
                        })
                      }
                    />
                  </td>
                  {(['indice_anterior', 'indice_atual'] as const).map((campo) => (
                    <td key={campo} className="px-2 py-1">
                      <Input
                        className="h-6 w-32 ml-auto text-right"
                        defaultValue={String(g[campo]).replace('.', ',')}
                        disabled={!editavel}
                        onBlur={(e) => {
                          const v = parseBR(e.target.value).toNumber()
                          if (!(v > 0) || v === g[campo]) return
                          salvarGrupo.mutate(
                            { id: g.id, reajuste_id: reajuste.id, [campo]: v },
                            { onError: (err) => toast.error(err.message) }
                          )
                        }}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-accent">
                    {fmtPct2(g.indice_atual / g.indice_anterior - 1)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-text-muted">
                    {itens.filter((i) => i.grupo_id === g.id).length}
                  </td>
                  <td className="px-1">
                    {editavel ? (
                      <IconButton
                        size="sm"
                        variant="danger"
                        aria-label="Excluir grupo"
                        onClick={() => excluirGrupo.mutate({ id: g.id, reajuste_id: reajuste.id })}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    ) : null}
                  </td>
                </tr>
              ))}
              {editavel ? (
                <tr>
                  <td colSpan={6} className="px-2 py-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        salvarGrupo.mutate(
                          {
                            reajuste_id: reajuste.id,
                            ordem: grupos.length,
                            nome: `Grupo ${grupos.length + 1}`,
                            indice_anterior: 100,
                            indice_atual: 100
                          },
                          { onError: (err) => toast.error(err.message) }
                        )
                      }
                    >
                      <Plus size={12} /> Grupo
                    </Button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Classificação */}
      <section>
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <h3 className="text-2xs font-mono uppercase tracking-wider text-text-dim">
            Classificação das receitas ({itens.length} classificadas)
          </h3>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="checkbox" checked={soSem} onChange={(e) => setSoSem(e.target.checked)} />
            Só sem grupo
          </label>
          {editavel && selecionadas.size > 0 ? (
            <div className="flex items-center gap-2 ml-auto text-xs">
              <span className="text-text-muted">
                {contar(selecionadas.size, 'selecionada', 'selecionadas')} →
              </span>
              <Select
                className="h-7 w-48"
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  classificar.mutate(
                    {
                      reajuste_id: reajuste.id,
                      receita_ids: [...selecionadas],
                      grupo_id: v === '__sem' ? null : v
                    },
                    {
                      onSuccess: () => setSelecionadas(new Set()),
                      onError: (err) => toast.error(err.message)
                    }
                  )
                  e.target.value = ''
                }}
              >
                <option value="">Classificar em…</option>
                {grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
                <option value="__sem">(sem grupo)</option>
              </Select>
            </div>
          ) : null}
        </div>
        <div className="rounded border border-border bg-bg-panel overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
              <tr className="border-b border-border">
                <th className="w-8" />
                <th className="text-left px-2 py-1.5">Código · descrição</th>
                <th className="text-right px-2 py-1.5">Qtd</th>
                <th className="text-right px-2 py-1.5">Preço atual</th>
                <th className="text-left px-2 py-1.5">Grupo</th>
                <th className="text-right px-2 py-1.5">Preço reajustado</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((n) => {
                if (n.tipo === 'etapa') {
                  return (
                    <tr key={n.id} className="border-b border-border bg-bg-elevated/40">
                      <td className="px-2">
                        {editavel ? (
                          <input
                            type="checkbox"
                            title="Selecionar as receitas desta etapa"
                            onChange={() => marcarEtapa(n.codigo)}
                          />
                        ) : null}
                      </td>
                      <td colSpan={5} className="px-2 py-1 font-semibold text-text">
                        {n.codigo} · {n.descricao}
                      </td>
                    </tr>
                  )
                }
                const gid = grupoDe.get(n.id)
                const it = itemDe.get(n.id)
                const preco = rascunho
                  ? Number(n.venda_unitaria ?? 0)
                  : (it?.preco_antes ?? Number(n.venda_unitaria ?? 0))
                const novo = !gid
                  ? null
                  : rascunho
                    ? Math.round(preco * (fatorDe.get(gid) ?? 1) * 100) / 100
                    : (it?.preco_depois ?? null)
                return (
                  <tr key={n.id} className="border-b border-border">
                    <td className="px-2">
                      {editavel ? (
                        <input
                          type="checkbox"
                          checked={selecionadas.has(n.id)}
                          onChange={() =>
                            setSelecionadas((s) => {
                              const nx = new Set(s)
                              if (nx.has(n.id)) nx.delete(n.id)
                              else nx.add(n.id)
                              return nx
                            })
                          }
                        />
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-text">
                      <span className="font-mono text-text-dim mr-2">{n.codigo}</span>
                      {n.descricao}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-text-muted">
                      {fmtQtd(n.quantidade ?? 0)} {n.unidade}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtBRL(preco)}</td>
                    <td className="px-2 py-1">
                      {editavel ? (
                        <Select
                          className="h-6 w-44"
                          value={gid ?? ''}
                          onChange={(e) =>
                            classificar.mutate(
                              {
                                reajuste_id: reajuste.id,
                                receita_ids: [n.id],
                                grupo_id: e.target.value || null
                              },
                              { onError: (err) => toast.error(err.message) }
                            )
                          }
                        >
                          <option value="">—</option>
                          {grupos.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.nome}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-text-muted">
                          {grupos.find((g) => g.id === gid)?.nome ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-accent">
                      {novo != null ? fmtBRL(novo) : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-bg font-mono text-2xs">
                <td colSpan={5} className="px-2 py-1.5 text-right text-text-dim uppercase">
                  Δ venda do reajuste
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-success">
                  {fmtBRL(deltaVenda)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}
