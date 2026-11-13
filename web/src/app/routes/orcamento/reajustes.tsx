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
import { Campo } from '@/components/ui/campo'
import { Select } from '@/components/ui/select'
import { IconButton } from '@/components/ui/IconButton'
import { Carregando, ErroConsulta, EstadoConsulta, EstadoGravacao } from '@/components/ui/estado'
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
import { cn } from '@/lib/utils'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

const ROTULO_COLUNA = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const TH = `px-2 py-1.5 ${ROTULO_COLUNA}`

const mensagem = (err: unknown): string => detalheDoErro(err) ?? ''

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

/** Retorno das edições que salvam ao sair do campo: salvando ou a falha da última gravação. */
function ReajustesInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const consulta = useReajustes(obraId)
  const reajustes = consulta.data ?? []
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

  const botaoNovo = podeEditar ? (
    <Button
      size="sm"
      onClick={() => setNovoOpen(true)}
      disabled={!dataBase}
      title={
        !dataBase ? 'Defina a data-base do orçamento para criar o primeiro reajuste' : undefined
      }
    >
      <Plus size={12} aria-hidden /> Novo reajuste
    </Button>
  ) : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Reajustes"
        breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Reajustes']}
        subtitle="Reajuste anual por grupos de índices, válido a partir da data informada"
        actions={
          <div className="flex items-center gap-2">
            <VoltarPlanilhaButton />
            {botaoNovo}
          </div>
        }
      />
      <div className="px-5 py-3 border-b border-border bg-bg-panel flex items-start gap-x-4 gap-y-2 flex-wrap">
        <Campo
          rotulo="Data-base do orçamento"
          className="w-48"
          dica={aplicados.length > 0 ? 'Não muda depois do primeiro reajuste aplicado.' : undefined}
        >
          <Input
            type="date"
            defaultValue={dataBase ?? ''}
            key={dataBase ?? 'vazia'}
            disabled={!podeEditar || aplicados.length > 0}
            onBlur={(e) => {
              if (!e.target.value || e.target.value === dataBase) return
              definirBase.mutate(
                { obra_id: obraId, data: e.target.value },
                {
                  onError: (err) =>
                    toast.error(`Não foi possível definir a data-base. ${err.message}`)
                }
              )
            }}
          />
        </Campo>
        <p className="text-sm text-text-muted pt-7">
          {definirBase.isPending
            ? 'Salvando a data-base…'
            : !dataBase
              ? 'Defina a data-base para criar o primeiro reajuste.'
              : proximaData
                ? `Próximo reajuste a partir de ${fmtDataBR(proximaData)}, 12 meses depois ${ultimo ? `do reajuste ${ultimo.numero}` : 'da data-base'}.`
                : null}
        </p>
      </div>
      <div className="flex-1 min-h-0 flex">
        <aside
          aria-label="Reajustes da obra"
          className="w-64 shrink-0 border-r border-border bg-bg-panel overflow-auto p-3"
        >
          <EstadoConsulta
            consulta={consulta}
            oQue="os reajustes"
            vazio={reajustes.length === 0}
            textoVazio={
              dataBase
                ? 'Nenhum reajuste nesta obra. Use "Novo reajuste" para criar o primeiro.'
                : 'Nenhum reajuste nesta obra. Defina a data-base acima para criar o primeiro.'
            }
            className="py-1"
          >
            <ul className="space-y-2">
              {reajustes.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={sel?.id === r.id ? 'true' : undefined}
                    onClick={() => setSelId(r.id)}
                    className={cn(
                      'w-full text-left rounded border px-2.5 py-2 text-sm',
                      sel?.id === r.id
                        ? 'border-accent-line bg-accent-glow'
                        : 'border-border hover:bg-bg-hover'
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text">Reajuste {r.numero}</span>
                      <Badge variant={r.status === 'aplicado' ? 'success' : 'warn'}>
                        {rotuloReajusteStatus(r.status)}
                      </Badge>
                    </span>
                    <span className="block mt-0.5 text-xs tabular text-text-muted">
                      {fmtDataBR(r.data)}
                    </span>
                    {r.descricao ? (
                      <span className="block mt-0.5 truncate text-text-muted">{r.descricao}</span>
                    ) : null}
                    {r.status === 'aplicado' && r.venda_antes != null && r.venda_depois != null ? (
                      <span className="block mt-0.5 text-xs tabular text-text-muted">
                        Variação da venda: {fmtBRL(r.venda_depois - r.venda_antes)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </EstadoConsulta>
        </aside>
        <section
          aria-label="Detalhe do reajuste"
          tabIndex={podeEditar ? undefined : 0}
          className="flex-1 min-w-0 overflow-auto"
        >
          {sel ? (
            <ReajusteEditor
              key={sel.id}
              reajuste={sel}
              obraId={obraId}
              podeEditar={podeEditar}
              proximaData={sel.status === 'rascunho' ? proximaData : null}
            />
          ) : consulta.isLoading || consulta.error ? null : (
            <EmptyState
              icon="percent"
              title="Nenhum reajuste criado"
              description={
                podeEditar
                  ? 'Crie um reajuste, monte os grupos de índices, classifique as receitas e aplique na data em que os novos preços passam a valer.'
                  : 'O reajuste corrige os preços de venda por grupos de índices. Esta obra ainda não tem nenhum.'
              }
              action={dataBase ? botaoNovo : null}
            />
          )}
        </section>
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
              toast.error(`Não foi possível criar o reajuste. ${mensagem(err)}`.trim())
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
  const [tentou, setTentou] = useState(false)
  const [criando, setCriando] = useState(false)

  const criar = async (): Promise<void> => {
    setTentou(true)
    if (!data) return
    setCriando(true)
    try {
      await onCriar(data, descricao, copiar)
    } finally {
      setCriando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm">
      <DialogHeader>
        <DialogTitle>Novo reajuste</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <Campo
          rotulo="Data do reajuste"
          obrigatorio
          dica="A partir de quando os novos preços valem."
          erro={tentou && !data ? 'Informe a data do reajuste.' : null}
        >
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Descrição">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: 1º reajuste anual"
          />
        </Campo>
        {anterior ? (
          <label className="flex items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="mt-1"
              checked={copiar}
              onChange={(e) => setCopiar(e.target.checked)}
            />
            <span>
              Copiar os grupos e a classificação do reajuste {anterior.numero}
              <span className="block text-text-muted">
                O índice anterior de cada grupo passa a ser o índice atual daquele reajuste.
              </span>
            </span>
          </label>
        ) : null}
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
  const detConsulta = useReajusteDetalhe(reajuste.id)
  const det = detConsulta.data
  const planConsulta = usePlanOrc(obraId)
  const plan = planConsulta.data
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
  const grupos = useMemo(() => det?.grupos ?? [], [det])
  const itens = useMemo(() => det?.itens ?? [], [det])
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
        `Os preços de venda de ${contar(itens.length, 'receita classificada', 'receitas classificadas')} mudam, com variação de ${fmtBRL(deltaVenda)} na venda.` +
        (semGrupo > 0
          ? ` ${contar(semGrupo, 'receita sem grupo fica', 'receitas sem grupo ficam')} sem reajuste.`
          : '') +
        ' O que foi executado ou planejado antes da data continua valorado pelo preço anterior. Não dá para desfazer.',
      confirmLabel: 'Aplicar reajuste',
      variant: 'warn'
    })
    if (!ok) return
    try {
      const r = await aplicar.mutateAsync({ id: reajuste.id })
      toast.success(
        `Reajuste ${r.numero} aplicado: a venda passou de ${fmtBRL(r.venda_antes)} para ${fmtBRL(r.venda_depois)}.`
      )
    } catch (err) {
      toast.error(`Não foi possível aplicar o reajuste. ${mensagem(err)}`.trim())
    }
  }

  const onExcluir = async (): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o rascunho do reajuste ${reajuste.numero}?`,
      description:
        'O rascunho, os grupos de índices e a classificação das receitas são apagados. Os preços de venda não mudam. Não dá para desfazer.',
      confirmLabel: 'Excluir rascunho',
      variant: 'danger'
    })
    if (ok) excluir.mutate({ id: reajuste.id })
  }

  const onExcluirGrupo = async (g: { id: string; nome: string }): Promise<void> => {
    const classificadas = itens.filter((i) => i.grupo_id === g.id).length
    const ok = await confirm({
      title: `Excluir o grupo "${g.nome}"?`,
      description:
        classificadas > 0
          ? `${contar(classificadas, 'receita classificada neste grupo deixa', 'receitas classificadas neste grupo deixam')} de ser reajustada por ele.`
          : 'Nenhuma receita está classificada neste grupo.',
      confirmLabel: 'Excluir grupo',
      variant: 'danger'
    })
    if (ok) excluirGrupo.mutate({ id: g.id, reajuste_id: reajuste.id })
  }

  const avisoData =
    rascunho && proximaData && reajuste.data < proximaData
      ? `A data precisa ser a partir de ${fmtDataBR(proximaData)} (intervalo de 12 meses).`
      : null

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-text">Reajuste {reajuste.numero}</h2>
            <Badge variant={rascunho ? 'warn' : 'success'}>
              {rotuloReajusteStatus(reajuste.status)}
            </Badge>
            <EstadoGravacao
              gravacoes={[atualizar, salvarGrupo, excluirGrupo, classificar, excluir]}
            />
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <Campo rotulo="Data" className={avisoData ? 'w-64' : 'w-40'} erro={avisoData}>
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
            </Campo>
            <Campo rotulo="Descrição" className="flex-1 min-w-[200px]">
              <Input
                defaultValue={reajuste.descricao ?? ''}
                disabled={!podeEditar}
                onBlur={(e) =>
                  e.target.value !== (reajuste.descricao ?? '') &&
                  atualizar.mutate({ id: reajuste.id, descricao: e.target.value || null })
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
                itens.length === 0
                  ? 'Classifique ao menos uma receita em um grupo para aplicar'
                  : undefined
              }
            >
              <Play size={12} aria-hidden /> {aplicar.isPending ? 'Aplicando…' : 'Aplicar reajuste'}
            </Button>
          </div>
        ) : null}
      </div>

      {detConsulta.isLoading ? (
        <Carregando texto="Carregando os grupos e a classificação…" />
      ) : detConsulta.error ? (
        <ErroConsulta
          erro={detConsulta.error}
          oQue="os grupos e a classificação do reajuste"
          aoTentar={() => void detConsulta.refetch()}
        />
      ) : (
        <>
          <section aria-label="Grupos de índices" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-md font-semibold text-text">Grupos de índices</h3>
              {editavel ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={salvarGrupo.isPending}
                  onClick={() =>
                    salvarGrupo.mutate(
                      {
                        reajuste_id: reajuste.id,
                        ordem: grupos.length,
                        nome: `Grupo ${grupos.length + 1}`,
                        indice_anterior: 100,
                        indice_atual: 100
                      },
                      {
                        onError: (err) =>
                          toast.error(`Não foi possível adicionar o grupo. ${err.message}`)
                      }
                    )
                  }
                >
                  <Plus size={12} aria-hidden /> Adicionar grupo
                </Button>
              ) : null}
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabela dos grupos de índices"
              className="rounded border border-border bg-bg-panel overflow-x-auto"
            >
              <table className="w-full text-sm tabular">
                <thead className="bg-bg-elevated border-b border-border-strong">
                  <tr>
                    <th scope="col" className={`${TH} text-left`}>
                      Grupo
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Índice anterior
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Índice atual
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Reajuste
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Receitas
                    </th>
                    <th scope="col" className="w-10">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-text-muted">
                        {editavel
                          ? 'Nenhum grupo de índices. Adicione um grupo e informe o índice anterior e o atual.'
                          : 'Este reajuste não tem grupos de índices.'}
                      </td>
                    </tr>
                  ) : null}
                  {grupos.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-1">
                        <Input
                          className="h-7"
                          aria-label="Nome do grupo"
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
                            className="h-7 w-32 ml-auto text-right tabular"
                            aria-label={`${campo === 'indice_anterior' ? 'Índice anterior' : 'Índice atual'} do grupo ${g.nome}`}
                            inputMode="decimal"
                            defaultValue={String(g[campo]).replace('.', ',')}
                            disabled={!editavel}
                            onBlur={(e) => {
                              const texto = e.target.value.trim()
                              const v = parseBR(texto).toNumber()
                              if (!/^\d[\d.,]*$/.test(texto) || !(v > 0)) {
                                toast.error(
                                  `Digite o índice do grupo ${g.nome} como um número maior que zero, por exemplo 1.234,56.`
                                )
                                e.target.value = String(g[campo]).replace('.', ',')
                                return
                              }
                              if (v === g[campo]) return
                              salvarGrupo.mutate(
                                { id: g.id, reajuste_id: reajuste.id, [campo]: v },
                                {
                                  onError: (err) =>
                                    toast.error(
                                      `Não foi possível salvar o índice do grupo ${g.nome}. ${err.message}`
                                    )
                                }
                              )
                            }}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right font-semibold text-text whitespace-nowrap">
                        {fmtPct2(g.indice_atual / g.indice_anterior - 1)}
                      </td>
                      <td className="px-2 py-1 text-right text-text-muted">
                        {itens.filter((i) => i.grupo_id === g.id).length}
                      </td>
                      <td className="px-1 text-right">
                        {editavel ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            aria-label={`Excluir o grupo ${g.nome}`}
                            title="Excluir grupo"
                            disabled={excluirGrupo.isPending}
                            onClick={() => void onExcluirGrupo(g)}
                          >
                            <Trash2 size={12} aria-hidden />
                          </IconButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Classificação das receitas" className="space-y-2">
            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-md font-semibold text-text">Classificação das receitas</h3>
                <span className="text-sm text-text-muted">
                  {contar(itens.length, 'receita classificada', 'receitas classificadas')}
                </span>
              </div>
              <label className="flex items-center gap-1.5 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={soSem}
                  onChange={(e) => setSoSem(e.target.checked)}
                />
                Mostrar só as receitas sem grupo
              </label>
              {editavel && selecionadas.size > 0 ? (
                <div className="flex items-center gap-2 ml-auto text-sm">
                  <span className="text-text-muted">
                    {contar(selecionadas.size, 'selecionada', 'selecionadas')}:
                  </span>
                  <div className="w-52">
                    <Select
                      className="h-7"
                      aria-label="Classificar as receitas selecionadas em um grupo"
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
                            onError: (err) =>
                              toast.error(
                                `Não foi possível classificar as receitas. ${err.message}`
                              )
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
                      <option value="__sem">Sem grupo</option>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>
            <EstadoConsulta
              consulta={planConsulta}
              oQue="a planilha orçamentária"
              vazio={(plan?.flat ?? []).length === 0}
              textoVazio="A planilha orçamentária ainda não tem itens. Monte a planilha para classificar as receitas."
            >
              <div
                tabIndex={0}
                role="region"
                aria-label="Tabela de classificação das receitas"
                className="rounded border border-border bg-bg-panel overflow-x-auto"
              >
                <table className="w-full text-sm tabular">
                  <thead className="bg-bg-elevated border-b border-border-strong">
                    <tr>
                      <th scope="col" className="w-9">
                        <span className="sr-only">Selecionar</span>
                      </th>
                      <th scope="col" className={`${TH} text-left`}>
                        Código e descrição
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Qtd.
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Preço atual
                      </th>
                      <th scope="col" className={`${TH} text-left`}>
                        Grupo
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Preço reajustado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((n) => {
                      if (n.tipo === 'etapa') {
                        return (
                          <tr key={n.id} className="border-b border-border bg-bg-elevated">
                            <td className="px-2">
                              {editavel ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar as receitas da etapa ${n.codigo}`}
                                  title="Selecionar as receitas desta etapa"
                                  onChange={() => marcarEtapa(n.codigo)}
                                />
                              ) : null}
                            </td>
                            <td colSpan={5} className="px-2 py-1.5 font-semibold text-text">
                              <span className="mr-2 text-text-dim">{n.codigo}</span>
                              {n.descricao}
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
                        <tr key={n.id} className="border-b border-border last:border-b-0">
                          <td className="px-2">
                            {editavel ? (
                              <input
                                type="checkbox"
                                aria-label={`Selecionar ${n.codigo}`}
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
                            <span className="text-text-dim mr-2">{n.codigo}</span>
                            {n.descricao}
                          </td>
                          <td className="px-2 py-1 text-right text-text-muted whitespace-nowrap">
                            {fmtQtd(n.quantidade ?? 0)} {n.unidade}
                          </td>
                          <td className="px-2 py-1 text-right text-text whitespace-nowrap">
                            {fmtBRL(preco)}
                          </td>
                          <td className="px-2 py-1">
                            {editavel ? (
                              <div className="w-44">
                                <Select
                                  className="h-7"
                                  aria-label={`Grupo de ${n.codigo}`}
                                  value={gid ?? ''}
                                  onChange={(e) =>
                                    classificar.mutate(
                                      {
                                        reajuste_id: reajuste.id,
                                        receita_ids: [n.id],
                                        grupo_id: e.target.value || null
                                      },
                                      {
                                        onError: (err) =>
                                          toast.error(
                                            `Não foi possível classificar ${n.codigo}. ${err.message}`
                                          )
                                      }
                                    )
                                  }
                                >
                                  <option value="">Sem grupo</option>
                                  {grupos.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.nome}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            ) : (
                              <span className="text-text-muted">
                                {grupos.find((g) => g.id === gid)?.nome ?? '—'}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold text-text whitespace-nowrap">
                            {novo != null ? fmtBRL(novo) : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-bg-elevated border-t border-border-strong">
                      <td colSpan={5} className={`px-2 py-2 text-right ${ROTULO_COLUNA}`}>
                        Variação da venda com o reajuste
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 text-right font-semibold whitespace-nowrap',
                          deltaVenda < 0 ? 'text-danger' : 'text-success'
                        )}
                      >
                        {fmtBRL(deltaVenda)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </EstadoConsulta>
          </section>
        </>
      )}
    </div>
  )
}
