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
import { Campo } from '@/components/ui/campo'
import { IconButton } from '@/components/ui/IconButton'
import {
  Carregando,
  ErroConsulta,
  EstadoConsulta,
  Vazio,
  EstadoGravacao
} from '@/components/ui/estado'
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
import { rotuloReajusteStatus } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import type { ItemTreeNode } from '@/types/orcamento'

const ROTULO_COLUNA = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const TH = `px-2 py-1.5 ${ROTULO_COLUNA}`

const mensagem = (err: unknown): string => (err instanceof Error ? err.message : '')

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

/** Retorno das edições que salvam ao sair do campo: salvando ou a falha da última gravação. */
function AditivosInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const navigate = useNavigate()

  const consulta = useAditivos(obraId)
  const aditivos = consulta.data ?? []
  const criar = useCriarAditivo()
  const [selId, setSelId] = useState<string | null>(null)
  const [novoOpen, setNovoOpen] = useState(false)
  const sel = aditivos.find((a) => a.id === selId) ?? aditivos[0] ?? null
  const temAplicado = aditivos.some((a) => a.status === 'aplicado')

  const botaoNovo = podeEditar ? (
    <Button size="sm" onClick={() => setNovoOpen(true)}>
      <Plus size={12} aria-hidden /> Novo aditivo
    </Button>
  ) : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Aditivos"
        breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Aditivos']}
        subtitle="Acréscimos, supressões, exclusões e itens novos na planilha de venda"
        actions={
          <div className="flex items-center gap-2">
            <VoltarPlanilhaButton />
            {temAplicado ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate({ to: '/orcamento/obra/planilha-inicial' })}
              >
                Ver planilha inicial
              </Button>
            ) : null}
            {botaoNovo}
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex">
        <aside
          aria-label="Aditivos da obra"
          className="w-64 shrink-0 border-r border-border bg-bg-panel overflow-auto p-3"
        >
          <EstadoConsulta
            consulta={consulta}
            oQue="os aditivos"
            vazio={aditivos.length === 0}
            textoVazio="Nenhum aditivo nesta obra. Quando o primeiro for aplicado, a planilha atual é arquivada como planilha inicial."
            className="py-1"
          >
            <ul className="space-y-2">
              {aditivos.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-current={sel?.id === a.id ? 'true' : undefined}
                    onClick={() => setSelId(a.id)}
                    className={cn(
                      'w-full text-left rounded border px-2.5 py-2 text-sm',
                      sel?.id === a.id
                        ? 'border-accent-line bg-accent-glow'
                        : 'border-border hover:bg-bg-hover'
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text">Aditivo {a.numero}</span>
                      <Badge variant={a.status === 'aplicado' ? 'success' : 'warn'}>
                        {rotuloReajusteStatus(a.status)}
                      </Badge>
                    </span>
                    <span className="block mt-0.5 text-xs tabular text-text-muted">
                      {fmtDataBR(a.data)}
                    </span>
                    {a.descricao ? (
                      <span className="block mt-0.5 truncate text-text-muted">{a.descricao}</span>
                    ) : null}
                    {a.status === 'aplicado' && a.venda_antes != null && a.venda_depois != null ? (
                      <span className="block mt-0.5 text-xs tabular text-text-muted">
                        Variação da venda: {fmtBRL(a.venda_depois - a.venda_antes)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </EstadoConsulta>
        </aside>
        <section
          aria-label="Detalhe do aditivo"
          tabIndex={podeEditar ? undefined : 0}
          className="flex-1 min-w-0 overflow-auto"
        >
          {sel ? (
            <AditivoEditor key={sel.id} aditivo={sel} obraId={obraId} podeEditar={podeEditar} />
          ) : consulta.isLoading || consulta.error ? null : (
            <EmptyState
              icon="file-plus-2"
              title="Nenhum aditivo criado"
              description={
                podeEditar
                  ? 'Crie um aditivo para alterar quantidades, excluir itens ou incluir itens novos na planilha de venda. Ele fica em rascunho até ser aplicado.'
                  : 'Aditivos alteram quantidades, excluem itens ou incluem itens novos na planilha de venda. Esta obra ainda não tem nenhum.'
              }
              action={botaoNovo}
            />
          )}
        </section>
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
              toast.error(`Não foi possível criar o aditivo. ${mensagem(err)}`.trim())
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
  const [tentou, setTentou] = useState(false)
  const [criando, setCriando] = useState(false)

  const criar = async (): Promise<void> => {
    setTentou(true)
    if (!data) return
    setCriando(true)
    try {
      await onCriar(data, descricao)
    } finally {
      setCriando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm">
      <DialogHeader>
        <DialogTitle>Novo aditivo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <Campo
          rotulo="Data do aditivo"
          obrigatorio
          erro={tentou && !data ? 'Informe a data do aditivo.' : null}
        >
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Descrição">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: adequação do transporte do CBUQ"
          />
        </Campo>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => void criar()} disabled={criando}>
          {criando ? 'Criando…' : 'Criar rascunho'}
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
  const itensConsulta = useAditivoItens(aditivo.id)
  const itens = useMemo(() => itensConsulta.data ?? [], [itensConsulta.data])
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
      toast.error(`${r.codigo} está alocada em serviço. Remova a alocação antes de excluir.`)
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
      toast.error(`Não foi possível incluir ${r.codigo} no aditivo. ${mensagem(err)}`.trim())
    }
  }

  const onAplicar = async (): Promise<void> => {
    const ok = await confirm({
      title: `Aplicar o aditivo ${aditivo.numero}?`,
      description:
        `A planilha de venda é alterada, com variação de ${fmtBRL(totalDelta)} na venda. ` +
        'No primeiro aditivo, a planilha atual fica arquivada como planilha inicial e, daí em diante, a planilha de venda só muda por aditivo. ' +
        'As linhas de base passam a avisar que as premissas mudaram. Não dá para desfazer.',
      confirmLabel: 'Aplicar aditivo',
      variant: 'warn'
    })
    if (!ok) return
    try {
      const r = await aplicar.mutateAsync({ id: aditivo.id })
      toast.success(
        `Aditivo ${r.numero} aplicado: a venda passou de ${fmtBRL(r.venda_antes)} para ${fmtBRL(r.venda_depois)}.${r.novos > 0 ? ' Itens novos sem serviço aparecem como saldo na planilha.' : ''}`
      )
    } catch (err) {
      toast.error(`Não foi possível aplicar o aditivo. ${mensagem(err)}`.trim())
    }
  }

  const onExcluir = async (): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o rascunho do aditivo ${aditivo.numero}?`,
      description:
        'O rascunho e os itens dele são apagados. A planilha de venda não muda. Não dá para desfazer.',
      confirmLabel: 'Excluir rascunho',
      variant: 'danger'
    })
    if (ok) excluir.mutate({ id: aditivo.id })
  }

  const onRemoverItem = async (it: AditivoItem): Promise<void> => {
    const ok = await confirm({
      title: `Remover ${it.codigo} do aditivo?`,
      description: 'A linha sai do rascunho. A planilha de venda não muda.',
      confirmLabel: 'Remover linha',
      variant: 'danger'
    })
    if (ok) excluirItem.mutate({ id: it.id, aditivo_id: aditivo.id })
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-text">Aditivo {aditivo.numero}</h2>
            <Badge variant={rascunho ? 'warn' : 'success'}>
              {rotuloReajusteStatus(aditivo.status)}
            </Badge>
            <EstadoGravacao gravacoes={[atualizar, salvar, excluirItem, excluir]} />
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <Campo rotulo="Data" className="w-40">
              <Input
                type="date"
                defaultValue={aditivo.data}
                disabled={!editavel}
                onBlur={(e) =>
                  e.target.value !== aditivo.data &&
                  atualizar.mutate({ id: aditivo.id, data: e.target.value })
                }
              />
            </Campo>
            <Campo rotulo="Descrição" className="flex-1 min-w-[200px]">
              <Input
                defaultValue={aditivo.descricao ?? ''}
                disabled={!podeEditar}
                onBlur={(e) =>
                  e.target.value !== (aditivo.descricao ?? '') &&
                  atualizar.mutate({ id: aditivo.id, descricao: e.target.value || null })
                }
              />
            </Campo>
          </div>
        </div>
        {editavel ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger hover:bg-danger/10"
              disabled={excluir.isPending}
              onClick={() => void onExcluir()}
            >
              <Trash2 size={12} aria-hidden />{' '}
              {excluir.isPending ? 'Excluindo…' : 'Excluir rascunho'}
            </Button>
            <Button
              size="sm"
              onClick={() => void onAplicar()}
              disabled={itens.length === 0 || aplicar.isPending}
              title={
                itens.length === 0 ? 'Inclua ao menos um item no aditivo para aplicar' : undefined
              }
            >
              <Play size={12} aria-hidden /> {aplicar.isPending ? 'Aplicando…' : 'Aplicar aditivo'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-md font-semibold text-text">Itens do aditivo</h3>
        {editavel ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPicker('quantidade')}
              title="Acréscimo ou supressão na quantidade de um item da planilha"
            >
              <Pencil size={12} aria-hidden /> Alterar quantidade
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPicker('exclusao')}>
              <Minus size={12} aria-hidden /> Excluir item
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setNovoOpen(true)}>
              <PackagePlus size={12} aria-hidden /> Incluir item novo
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded border border-border bg-bg-panel overflow-x-auto">
        <table className="w-full text-sm tabular">
          <thead className="bg-bg-elevated border-b border-border-strong">
            <tr>
              <th scope="col" className={`${TH} text-left`}>
                Tipo
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Código
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Descrição
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Un.
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Qtd. atual
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Qtd. nova
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Preço
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Variação da venda
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {itensConsulta.isLoading ? (
              <tr>
                <td colSpan={9} className="px-3">
                  <Carregando className="py-4" />
                </td>
              </tr>
            ) : itensConsulta.error ? (
              <tr>
                <td colSpan={9} className="p-3">
                  <ErroConsulta
                    erro={itensConsulta.error}
                    oQue="os itens do aditivo"
                    aoTentar={() => void itensConsulta.refetch()}
                    compacto
                  />
                </td>
              </tr>
            ) : itens.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3">
                  <Vazio className="py-4">
                    {editavel
                      ? 'Este aditivo ainda não tem itens. Use os botões acima para alterar quantidades, excluir itens ou incluir itens novos.'
                      : 'Este aditivo não tem itens.'}
                  </Vazio>
                </td>
              </tr>
            ) : (
              itens.map((it) => {
                const r = it.receita_id ? porId.get(it.receita_id) : undefined
                const atual = rascunho ? (r?.quantidade ?? null) : it.quantidade_antes
                const dv = deltaVenda(it)
                return (
                  <tr key={it.id} className="border-b border-border">
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
                    <td className="px-2 py-1.5 text-text-dim whitespace-nowrap">{it.codigo}</td>
                    <td className="px-2 py-1.5 text-text">
                      {it.descricao}
                      {it.tipo === 'novo' && it.alocacao?.destinos?.[0] ? (
                        <div className="text-xs text-text-muted">
                          Vai para {it.alocacao.destinos[0].servico ?? 'um serviço existente'}
                          {it.alocacao.compoe ? ', compondo a quantidade do serviço' : ''}
                        </div>
                      ) : it.tipo === 'novo' ? (
                        <div className="text-xs font-medium text-warn">
                          Sem serviço: entra como saldo
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-text-muted">{it.unidade ?? ''}</td>
                    <td className="px-2 py-1.5 text-right text-text-muted whitespace-nowrap">
                      {atual != null ? fmtQtd(atual) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                      {it.tipo === 'quantidade' && editavel ? (
                        <Input
                          className="h-7 w-28 text-right ml-auto tabular"
                          aria-label={`Quantidade nova de ${it.codigo}`}
                          inputMode="decimal"
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
                    <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                      {it.venda_unitaria != null ? fmtBRL(it.venda_unitaria) : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-1.5 text-right whitespace-nowrap',
                        dv < 0 ? 'text-danger' : dv > 0 ? 'text-success' : 'text-text-muted'
                      )}
                    >
                      {fmtBRL(dv)}
                    </td>
                    <td className="px-1 py-1 text-right">
                      {editavel ? (
                        <IconButton
                          size="sm"
                          variant="danger"
                          aria-label={`Remover ${it.codigo} do aditivo`}
                          title="Remover do aditivo"
                          disabled={excluirItem.isPending}
                          onClick={() => void onRemoverItem(it)}
                        >
                          <Trash2 size={12} aria-hidden />
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
              <tr className="bg-bg-elevated">
                <td colSpan={7} className={`px-2 py-2 text-right ${ROTULO_COLUNA}`}>
                  Variação da venda com o aditivo
                </td>
                <td
                  className={cn(
                    'px-2 py-2 text-right font-semibold whitespace-nowrap',
                    totalDelta < 0 ? 'text-danger' : 'text-success'
                  )}
                >
                  {fmtBRL(totalDelta)}
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="max-w-[90ch] text-sm text-text-muted">
        A supressão só é recusada se a quantidade do serviço ficar abaixo do que já foi executado.
        Só dá para excluir receita que não esteja alocada em serviço. Itens novos sem serviço
        aparecem como saldo na barra de progresso da planilha e podem ser agrupados ou rateados
        depois, mesmo com plano vigente.
      </p>

      {picker ? (
        <ReceitaPicker
          titulo={picker === 'quantidade' ? 'Alterar quantidade' : 'Excluir item'}
          receitas={receitas}
          carregando={!plan}
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
              toast.error(`Não foi possível incluir o item no aditivo. ${mensagem(err)}`.trim())
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
  carregando,
  bloqueadas,
  jaNoAditivo,
  onPick,
  onClose
}: {
  titulo: string
  receitas: ItemTreeNode[]
  carregando: boolean
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
        <DialogTitle>{titulo}: escolha a receita</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-2">
        <Input
          autoFocus
          aria-label="Buscar receita por código ou descrição"
          placeholder="Buscar por código ou descrição"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {carregando ? (
          <Carregando texto="Carregando a planilha orçamentária…" className="py-3" />
        ) : lista.length === 0 ? (
          <Vazio className="py-3">
            {busca.trim()
              ? 'Nenhuma receita corresponde à busca. Confira o código ou a descrição.'
              : 'Não há receitas disponíveis: a planilha está vazia ou todas já estão neste aditivo.'}
          </Vazio>
        ) : (
          <ul
            tabIndex={0}
            aria-label="Receitas da planilha"
            className="max-h-[50vh] overflow-auto rounded border border-border divide-y divide-border"
          >
            {lista.map((r) => {
              const bloq = bloqueadas.has(r.id)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={bloq}
                    onClick={() => onPick(r)}
                    title={
                      bloq ? 'Alocada em serviço: remova a alocação antes de excluir' : undefined
                    }
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-bg-hover disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span className="tabular text-text-dim w-16 shrink-0">{r.codigo}</span>
                    <span className={cn('flex-1 truncate', bloq ? 'text-text-dim' : 'text-text')}>
                      {r.descricao}
                    </span>
                    {bloq ? (
                      <span className="shrink-0 text-xs text-text-muted">Alocada em serviço</span>
                    ) : null}
                    <span className="shrink-0 tabular text-text-muted">
                      {fmtQtd(r.quantidade ?? 0)} {r.unidade}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
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
  const [tentou, setTentou] = useState(false)
  const [incluindo, setIncluindo] = useState(false)
  const etapa = !unidade.trim() && !qtd.trim()
  const codigoOk = /^[0-9]+(\.[0-9]+)*$/.test(codigo.trim())
  const valido =
    codigoOk && descricao.trim() && (etapa || (unidade.trim() && qtd.trim() && preco.trim()))
  const existente = servicos.find((s) => s.nome.toLowerCase() === servico.trim().toLowerCase())

  const erro = (falta: boolean, msg: string): string | null => (tentou && falta ? msg : null)

  const incluir = async (): Promise<void> => {
    setTentou(true)
    if (!valido) return
    setIncluindo(true)
    try {
      await onSalvar({
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
    } finally {
      setIncluindo(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>Incluir item novo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <Campo
            rotulo="Código"
            obrigatorio
            erro={erro(!codigoOk, 'Use números com ponto, como 02.09.')}
          >
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="02.09" />
          </Campo>
          <Campo
            rotulo="Descrição"
            obrigatorio
            erro={erro(!descricao.trim(), 'Informe a descrição do item.')}
          >
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo rotulo="Unidade" erro={erro(!etapa && !unidade.trim(), 'Informe a unidade.')}>
            <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="m³" />
          </Campo>
          <Campo rotulo="Quantidade" erro={erro(!etapa && !qtd.trim(), 'Informe a quantidade.')}>
            <Input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
          </Campo>
          <Campo
            rotulo="Preço unitário"
            erro={erro(!etapa && !preco.trim(), 'Informe o preço unitário.')}
          >
            <Input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" />
          </Campo>
        </div>
        <p className="text-sm text-text-muted">
          Sem unidade e sem quantidade, o item entra como etapa (título). O item pai é definido pelo
          prefixo do código.
        </p>
        {!etapa ? (
          <div className="rounded border border-border p-3 space-y-2">
            <Campo
              rotulo="Serviço (opcional)"
              dica={
                !servico.trim()
                  ? 'Em branco, o item entra como saldo, sem serviço.'
                  : existente
                    ? `Vai para o serviço existente ${existente.codigo}.`
                    : 'Cria um serviço novo, sem composição.'
              }
            >
              <Input
                list="aditivo-servicos"
                value={servico}
                onChange={(e) => setServico(e.target.value)}
                placeholder="Escolha um serviço ou digite o nome de um novo"
              />
            </Campo>
            <datalist id="aditivo-servicos">
              {servicos.map((s) => (
                <option key={s.id} value={s.nome}>
                  {s.codigo}
                </option>
              ))}
            </datalist>
            {servico.trim() ? (
              <label className="flex items-center gap-2 text-sm text-text">
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
        <Button disabled={incluindo} onClick={() => void incluir()}>
          <FilePlus2 size={12} aria-hidden /> {incluindo ? 'Incluindo…' : 'Incluir no aditivo'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
