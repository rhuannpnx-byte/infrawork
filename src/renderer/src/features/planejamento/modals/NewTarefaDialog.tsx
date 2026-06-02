import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  Flag,
  FolderPlus,
  ListPlus,
  ChevronDown,
  ChevronRight,
  Hourglass
} from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { TabPill } from '@/components/ui/TabPill'
import {
  CONSTRAINT_LABEL,
  SCHEDULE_MODE_LABEL,
  type ConstraintType,
  type ScheduleMode
} from '@/types/planejamento'
import {
  useTarefas,
  useItensSincronizaveis,
  useImportarItensSelecionados,
  useCreateGrupo,
  useCreateMarco,
  traduzirErroPlanejamento,
  type ImportarItemRow
} from '../hooks/tarefas'
import { useObraTrechos } from '../hooks/trechos'
import { usePlanejamentos } from '../hooks/planejamentos'
import { useCriarTarefaIndireta } from '../hooks/indireto-config'
import { useTaxas } from '@/features/orcamento/hooks/taxas'
import { AlocacaoIndicator } from '../components/AlocacaoIndicator'
import { fmtBRL } from '@/lib/money'
import type {
  CustoPeriodicidade,
  ReceitaModoIndireto
} from '@/types/planejamento'

type Tab = 'tarefa' | 'grupo' | 'marco' | 'indireto'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  planejamentoId: string
  obraId: string
  /** Aba inicial. Default 'tarefa'. */
  tabInicial?: Tab
  /** Data sugestão pra marcos (geralmente a âncora do plano). */
  dataPadraoMarco?: string
}

/**
 * Dialog unificado para criação de novos itens no cronograma.
 *
 * Três abas com estética compartilhada (Label uppercase mono + Select/Input do
 * design system + hint `text-2xs font-mono leading-relaxed`):
 *   - **Tarefa**: import seletivo de N itens orçados em drafts verticais
 *     separados por `border-b border-border`. Sem scroll horizontal.
 *   - **Grupo**: nó organizacional da EAP (nível 1 ou 2).
 *   - **Marco**: evento sem duração (milestone).
 */
export function NewTarefaDialog({
  open,
  onOpenChange,
  planejamentoId,
  obraId,
  tabInicial = 'tarefa',
  dataPadraoMarco
}: Props): ReactNode {
  const [tab, setTab] = useState<Tab>(tabInicial)
  useEffect(() => {
    if (open) setTab(tabInicial)
  }, [open, tabInicial])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="h-[520px] max-h-[85vh] flex flex-col"
    >
      <DialogHeader>
        <DialogTitle>Adicionar ao cronograma</DialogTitle>
      </DialogHeader>
      <div className="flex border-b border-border px-4 shrink-0" role="tablist">
        <TabPill active={tab === 'tarefa'} onClick={() => setTab('tarefa')} className="px-3">
          <ListPlus size={11} />
          Tarefas
        </TabPill>
        <TabPill active={tab === 'grupo'} onClick={() => setTab('grupo')} className="px-3">
          <FolderPlus size={11} />
          Grupo
        </TabPill>
        <TabPill active={tab === 'marco'} onClick={() => setTab('marco')} className="px-3">
          <Flag size={11} />
          Marco
        </TabPill>
        <TabPill active={tab === 'indireto'} onClick={() => setTab('indireto')} className="px-3">
          <Hourglass size={11} />
          Indireto
        </TabPill>
      </div>

      {tab === 'tarefa' ? (
        <TarefasTab
          planejamentoId={planejamentoId}
          obraId={obraId}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
      {tab === 'grupo' ? (
        <GrupoTab
          planejamentoId={planejamentoId}
          obraId={obraId}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
      {tab === 'marco' ? (
        <MarcoTab
          planejamentoId={planejamentoId}
          obraId={obraId}
          dataPadrao={dataPadraoMarco}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
      {tab === 'indireto' ? (
        <IndiretoTab
          planejamentoId={planejamentoId}
          obraId={obraId}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  )
}

// ─── Aba Tarefa: drafts verticais ──────────────────────────────────────────
interface TarefaDraft {
  /** id único do row no UI (não é gravado). */
  uid: string
  item_orcamentario_id: string
  trecho_id: string
  quantidade_alocada: string
  parent_id: string
  data_inicio: string
  schedule_mode: ScheduleMode
  constraint_type: '' | ConstraintType
  constraint_date: string
  /** Toggle UI: mostra/esconde seção de restrição. Não persistido. */
  restricaoAberta: boolean
}

function makeUid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function emptyDraft(dataInicioDefault = ''): TarefaDraft {
  return {
    uid: makeUid(),
    item_orcamentario_id: '',
    trecho_id: '',
    quantidade_alocada: '',
    parent_id: '',
    data_inicio: dataInicioDefault,
    schedule_mode: 'asap',
    constraint_type: '',
    constraint_date: '',
    restricaoAberta: false
  }
}

function TarefasTab({
  planejamentoId,
  obraId,
  onClose
}: {
  planejamentoId: string
  obraId: string
  onClose: () => void
}): ReactNode {
  const { data: itensAll = [] } = useItensSincronizaveis(planejamentoId, obraId)
  // Aba "Tarefas" só lista items DIRETOS (servico_id). Indiretos vão pra aba "Indireto".
  const itens = useMemo(() => itensAll.filter((i) => i.indireto_id == null), [itensAll])
  const { data: trechos = [] } = useObraTrechos(obraId)
  const { data: tarefas = [] } = useTarefas(planejamentoId)
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const importar = useImportarItensSelecionados()

  const planejamento = useMemo(
    () => planejamentos.find((p) => p.id === planejamentoId) ?? null,
    [planejamentos, planejamentoId]
  )
  const dataInicioDefault = planejamento?.data_referencia_inicio ?? ''

  const [rows, setRows] = useState<TarefaDraft[]>([emptyDraft()])
  const [error, setError] = useState<string | null>(null)

  const itensById = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens])
  const gruposByid = useMemo(
    () => new Map(tarefas.filter((t) => t.tipo_no === 'grupo').map((g) => [g.id, g])),
    [tarefas]
  )

  // Trecho default = primeiro da obra (compat com sincronizar legado).
  const trechoDefault = trechos[0]?.id ?? ''

  // Reset ao abrir o dialog (mount). Default data_inicio = âncora do planejamento.
  useEffect(() => {
    setRows([{ ...emptyDraft(dataInicioDefault), trecho_id: trechoDefault }])
    setError(null)
  }, [trechoDefault, dataInicioDefault])

  const addRow = (): void =>
    setRows((prev) => [
      ...prev,
      { ...emptyDraft(dataInicioDefault), trecho_id: trechoDefault }
    ])
  const removeRow = (uid: string): void =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.uid !== uid)))
  const updateRow = (uid: string, patch: Partial<TarefaDraft>): void =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))

  // Ao escolher item, sugere quantidade_alocada = restante.
  const onChangeItem = (uid: string, item_orcamentario_id: string): void => {
    const it = itensById.get(item_orcamentario_id)
    updateRow(uid, {
      item_orcamentario_id,
      quantidade_alocada:
        it && it.restante > 0 ? String(it.restante) : it ? String(it.quantidade_referencia) : ''
    })
  }

  const linhasValidas: ImportarItemRow[] | null = useMemo(() => {
    const out: ImportarItemRow[] = []
    for (const r of rows) {
      if (!r.item_orcamentario_id) return null
      if (!r.trecho_id) return null
      // <input type="number"> retorna sempre formato US (ponto = decimal),
      // sem separador de milhar — Number() é o parse certo. parseBR é pro
      // caso de input texto com vírgula brasileira.
      const qtd = Number(r.quantidade_alocada)
      if (!Number.isFinite(qtd) || qtd <= 0) return null
      let nivel: 1 | 2 | 3 = 1
      if (r.parent_id) {
        const parent = gruposByid.get(r.parent_id)
        if (!parent) return null
        nivel = ((parent.nivel as number) + 1) as 1 | 2 | 3
        if (nivel > 3) return null
      }
      // Constraint válida só com data; se um sem o outro, ignora a constraint
      // toda (UI já avisa via hint mas mantém o submit funcional).
      const cType: ConstraintType | null =
        r.constraint_type && r.constraint_date ? r.constraint_type : null
      const cDate = cType ? r.constraint_date : null
      out.push({
        item_orcamentario_id: r.item_orcamentario_id,
        trecho_id: r.trecho_id,
        quantidade_alocada: qtd,
        parent_id: r.parent_id || null,
        nivel,
        data_inicio: r.data_inicio || null,
        schedule_mode: r.schedule_mode,
        constraint_type: cType,
        constraint_date: cDate
      })
    }
    return out
  }, [rows, gruposByid])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!linhasValidas) {
      setError('Preencha item, trecho e quantidade em todas as linhas (quantidade > 0).')
      return
    }
    try {
      const r = await importar.mutateAsync({
        planejamento_id: planejamentoId,
        itens: linhasValidas
      })
      toast.success(`${r.criadas} tarefa(s) criada(s).`)
      onClose()
    } catch (err) {
      const msg = traduzirErroPlanejamento(err)
      setError(msg)
    }
  }

  const semItens = itens.length === 0
  const semTrechos = trechos.length === 0
  const gruposDisponiveis = useMemo(
    () => tarefas.filter((t) => t.tipo_no === 'grupo' && t.nivel < 3),
    [tarefas]
  )

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
      <DialogBody className="flex-1 min-h-0 flex flex-col space-y-3">
        <DialogErrorBanner message={error} />

        {semTrechos ? (
          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-2xs font-mono text-warning leading-relaxed">
            Nenhum trecho cadastrado. Crie um trecho em Planejamento → Trechos antes de importar.
          </div>
        ) : null}
        {semItens ? (
          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-2xs font-mono text-warning leading-relaxed">
            Nenhum item orçado tipo servico_grupo. Adicione ao orçamento primeiro.
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {rows.map((r, idx) => {
            const it = r.item_orcamentario_id ? itensById.get(r.item_orcamentario_id) : null
            const unidade = it?.unidade ?? ''
            return (
              <div
                key={r.uid}
                className="border-b border-border last:border-0 py-3 first:pt-0 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs uppercase tracking-wider text-text-dim font-mono">
                    Tarefa {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(r.uid)}
                    disabled={rows.length === 1}
                    className="text-text-dim hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Remover tarefa"
                    title="Remover tarefa"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <div>
                  <Label htmlFor={`tar-${r.uid}-item`}>Item orçado</Label>
                  <Select
                    id={`tar-${r.uid}-item`}
                    value={r.item_orcamentario_id}
                    onChange={(e) => onChangeItem(r.uid, e.target.value)}
                    autoFocus={idx === 0}
                  >
                    <option value="">Selecione…</option>
                    {itens.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.codigo} — {i.descricao}
                      </option>
                    ))}
                  </Select>
                  {it ? (
                    <div className="text-2xs text-text-dim mt-1 font-mono leading-relaxed flex items-center gap-1.5 flex-wrap">
                      <AlocacaoIndicator
                        alocado={it.alocado}
                        total={it.quantidade_referencia}
                        unidade={it.unidade}
                      />
                      {it.count > 0 ? (
                        <span>
                          · {it.count} tarefa{it.count > 1 ? 's' : ''} já criada
                          {it.count > 1 ? 's' : ''}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`tar-${r.uid}-trecho`}>Trecho</Label>
                    <Select
                      id={`tar-${r.uid}-trecho`}
                      value={r.trecho_id}
                      onChange={(e) => updateRow(r.uid, { trecho_id: e.target.value })}
                    >
                      <option value="">—</option>
                      {trechos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`tar-${r.uid}-qtd`}>Qtd alocada</Label>
                    <div className="relative">
                      <Input
                        id={`tar-${r.uid}-qtd`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        value={r.quantidade_alocada}
                        onChange={(e) => updateRow(r.uid, { quantidade_alocada: e.target.value })}
                        placeholder={it ? String(it.restante || it.quantidade_referencia) : '—'}
                        className={`text-right font-mono tabular-nums ${unidade ? 'pr-10' : ''}`}
                      />
                      {unidade ? (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-2xs font-mono text-text-dim">
                          {unidade}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`tar-${r.uid}-grupo`}>Grupo (opcional)</Label>
                    <Select
                      id={`tar-${r.uid}-grupo`}
                      value={r.parent_id}
                      onChange={(e) => updateRow(r.uid, { parent_id: e.target.value })}
                    >
                      <option value="">— raiz —</option>
                      {gruposDisponiveis.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nome_custom ?? g.servico_grupo_descricao ?? '(grupo)'} (n{g.nivel})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`tar-${r.uid}-data`}>Início (opcional)</Label>
                    <Input
                      id={`tar-${r.uid}-data`}
                      type="date"
                      value={r.data_inicio}
                      onChange={(e) => updateRow(r.uid, { data_inicio: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() =>
                      updateRow(r.uid, { restricaoAberta: !r.restricaoAberta })
                    }
                    className="flex items-center gap-1 text-2xs uppercase tracking-wider text-text-dim hover:text-text font-mono"
                  >
                    {r.restricaoAberta ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    Restrição (opcional)
                  </button>
                  {r.restricaoAberta ? (
                    <div className="mt-2 space-y-2 rounded border border-border bg-bg-elevated/40 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor={`tar-${r.uid}-smode`}>Agendamento</Label>
                          <Select
                            id={`tar-${r.uid}-smode`}
                            value={r.schedule_mode}
                            onChange={(e) =>
                              updateRow(r.uid, {
                                schedule_mode: e.target.value as ScheduleMode
                              })
                            }
                          >
                            {(Object.keys(SCHEDULE_MODE_LABEL) as ScheduleMode[]).map(
                              (m) => (
                                <option key={m} value={m}>
                                  {SCHEDULE_MODE_LABEL[m]}
                                </option>
                              )
                            )}
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`tar-${r.uid}-ctype`}>Tipo de restrição</Label>
                          <Select
                            id={`tar-${r.uid}-ctype`}
                            value={r.constraint_type}
                            onChange={(e) =>
                              updateRow(r.uid, {
                                constraint_type: e.target.value as '' | ConstraintType,
                                // Limpa data se tirar o tipo
                                ...(e.target.value === '' ? { constraint_date: '' } : {})
                              })
                            }
                          >
                            <option value="">— sem restrição —</option>
                            {(Object.keys(CONSTRAINT_LABEL) as ConstraintType[]).map(
                              (t) => (
                                <option key={t} value={t}>
                                  {CONSTRAINT_LABEL[t]}
                                </option>
                              )
                            )}
                          </Select>
                        </div>
                      </div>
                      {r.constraint_type ? (
                        <div>
                          <Label htmlFor={`tar-${r.uid}-cdate`}>Data da restrição</Label>
                          <Input
                            id={`tar-${r.uid}-cdate`}
                            type="date"
                            value={r.constraint_date}
                            onChange={(e) =>
                              updateRow(r.uid, { constraint_date: e.target.value })
                            }
                            className="font-mono"
                            required
                          />
                        </div>
                      ) : null}
                      <p className="text-2xs font-mono text-text-dim leading-relaxed">
                        Opcional — pode editar depois pelo popover de restrição na tabela do
                        cronograma.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={addRow}>
            <Plus size={11} /> Adicionar tarefa
          </Button>
        </div>

        <div className="mt-auto text-2xs text-text-dim font-mono pt-2 border-t border-border leading-relaxed">
          Cada bloco vira uma tarefa-folha. Você pode criar N tarefas pro mesmo item orçado (ex:
          duas frentes em paralelo) — a soma das quantidades alocadas não pode ultrapassar o
          orçado, e o sinalizador amarelo aparece quando ficar abaixo.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={importar.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={importar.isPending || !linhasValidas || linhasValidas.length === 0}
        >
          {importar.isPending
            ? 'Criando…'
            : `Criar ${linhasValidas?.length ?? 0} tarefa${(linhasValidas?.length ?? 0) > 1 ? 's' : ''}`}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── Aba Grupo ────────────────────────────────────────────────────────────
function GrupoTab({
  planejamentoId,
  obraId,
  onClose
}: {
  planejamentoId: string
  obraId: string
  onClose: () => void
}): ReactNode {
  const create = useCreateGrupo()
  const { data: tarefas = [] } = useTarefas(planejamentoId)
  const [nome, setNome] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const gruposNivel1 = useMemo(
    () => tarefas.filter((t) => t.tipo_no === 'grupo' && t.nivel === 1),
    [tarefas]
  )

  const reset = (): void => {
    setNome('')
    setParentId('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const nomeTrim = nome.trim()
    if (!nomeTrim) {
      setError('Informe o nome do grupo.')
      return
    }
    const nivel = parentId === '' ? 1 : 2
    try {
      await create.mutateAsync({
        planejamento_id: planejamentoId,
        obra_id: obraId,
        nome: nomeTrim,
        parent_id: parentId === '' ? null : parentId,
        nivel
      })
      toast.success('Grupo criado.')
      reset()
      onClose()
    } catch (err) {
      setError(traduzirErroPlanejamento(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
      <DialogBody className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto">
        <DialogErrorBanner message={error} />
        <div>
          <Label htmlFor="grp-nome">Nome</Label>
          <Input
            id="grp-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Drenagem, Pavimentação, Mobilização"
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="grp-parent">Pai (opcional)</Label>
          <Select
            id="grp-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— raiz (nível 1) —</option>
            {gruposNivel1.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome_custom ?? g.servico_grupo_descricao ?? '(sem nome)'} (nível 1)
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-auto text-2xs text-text-dim font-mono pt-2 border-t border-border leading-relaxed">
          Grupos organizam a EAP em até 2 níveis. Arraste tarefas-folha (ou marcos) para dentro do
          grupo via drag-and-drop no Gantt.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={create.isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="default" size="sm" disabled={create.isPending}>
          {create.isPending ? 'Criando…' : 'Adicionar grupo'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── Aba Marco ────────────────────────────────────────────────────────────
function MarcoTab({
  planejamentoId,
  obraId,
  dataPadrao,
  onClose
}: {
  planejamentoId: string
  obraId: string
  dataPadrao?: string
  onClose: () => void
}): ReactNode {
  const create = useCreateMarco()
  const { data: trechos = [] } = useObraTrechos(obraId)
  const [nome, setNome] = useState('')
  const [dataInicio, setDataInicio] = useState(dataPadrao ?? '')
  const [trechoId, setTrechoId] = useState<string>('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDataInicio(dataPadrao ?? '')
  }, [dataPadrao])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const nomeTrim = nome.trim()
    if (!nomeTrim) {
      setError('Informe o nome do marco.')
      return
    }
    if (!dataInicio) {
      setError('Informe a data do marco.')
      return
    }
    try {
      await create.mutateAsync({
        planejamento_id: planejamentoId,
        obra_id: obraId,
        nome: nomeTrim,
        data_inicio: dataInicio,
        trecho_id: trechoId === '' ? null : trechoId,
        notas: notas.trim() || null
      })
      toast.success('Marco adicionado.')
      onClose()
    } catch (err) {
      setError(traduzirErroPlanejamento(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
      <DialogBody className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto">
        <DialogErrorBanner message={error} />
        <div>
          <Label htmlFor="mar-nome">Nome</Label>
          <Input
            id="mar-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Liberação do trecho, Aceite de fundação"
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mar-data">Data</Label>
            <Input
              id="mar-data"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="font-mono"
              required
            />
          </div>
          <div>
            <Label htmlFor="mar-trecho">Trecho (opcional)</Label>
            <Select
              id="mar-trecho"
              value={trechoId}
              onChange={(e) => setTrechoId(e.target.value)}
            >
              <option value="">— sem trecho —</option>
              {trechos.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="mar-notas">Notas (opcional)</Label>
          <Input
            id="mar-notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Contexto, fonte do prazo, etc."
          />
        </div>
        <div className="mt-auto text-2xs text-text-dim font-mono pt-2 border-t border-border leading-relaxed">
          Marcos não consomem recursos. Recalcular cronograma propaga eventuais dependências
          (FS/SS/FF/SF) entre marcos e tarefas.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={create.isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="default" size="sm" disabled={create.isPending}>
          {create.isPending ? 'Criando…' : 'Adicionar marco'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── Aba Indireto ─────────────────────────────────────────────────────────
// Tarefa indireta tem regra própria: custo recorrente (R$/dia, R$/mês, R$/ano),
// duração dimensionada pelo CPM (cobre todo o cronograma + offsets), receita
// pode ser direta (mesma lógica do custo) ou % do faturamento dos serviços
// diretos no período. Taxas opcionais incidem sobre a receita e viram custo.
function IndiretoTab({
  planejamentoId,
  obraId,
  onClose
}: {
  planejamentoId: string
  obraId: string
  onClose: () => void
}): ReactNode {
  const { data: itensAll = [] } = useItensSincronizaveis(planejamentoId, obraId)
  const itens = useMemo(() => itensAll.filter((i) => i.indireto_id != null), [itensAll])
  const { data: taxas = [] } = useTaxas(obraId)
  const taxasAtivas = useMemo(() => taxas.filter((t) => t.ativo), [taxas])
  const criar = useCriarTarefaIndireta()

  const [itemId, setItemId] = useState('')
  const [periodicidade, setPeriodicidade] = useState<CustoPeriodicidade>('mes')
  const [receitaModo, setReceitaModo] = useState<ReceitaModoIndireto>('mesma_logica_custo')
  const [receitaPct, setReceitaPct] = useState('')
  const [offsetAntes, setOffsetAntes] = useState('0')
  const [offsetDepois, setOffsetDepois] = useState('0')
  const [receitaExtrapola, setReceitaExtrapola] = useState(true)
  const [aplicaTaxas, setAplicaTaxas] = useState(false)
  const [taxaRegimeId, setTaxaRegimeId] = useState('')
  const [nomeCustom, setNomeCustom] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState<string | null>(null)

  const itemSelecionado = useMemo(
    () => itens.find((i) => i.id === itemId) ?? null,
    [itens, itemId]
  )

  // Custo/receita unitários derivados do orçamento (read-only).
  // Custo: indireto_item.valor_total (= item.custo_unitario_calc) — custo por período.
  // Receita "mesma lógica": item.venda_total_calc / quantidade_referencia.
  const custoUnitDerivado = itemSelecionado?.custo_unitario ?? 0
  const receitaUnitDerivada =
    itemSelecionado && itemSelecionado.venda_total != null && itemSelecionado.quantidade_referencia > 0
      ? itemSelecionado.venda_total / itemSelecionado.quantidade_referencia
      : 0

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!itemId) {
      setError('Selecione um item indireto do orçamento.')
      return
    }
    if (receitaModo === 'percentual_dos_servicos') {
      const rp = Number(receitaPct)
      if (!Number.isFinite(rp) || rp < 0 || rp > 100) {
        setError('Percentual precisa estar entre 0 e 100.')
        return
      }
    }
    if (aplicaTaxas && !taxaRegimeId) {
      setError('Selecione o regime de taxas ou desmarque "Aplica taxas".')
      return
    }
    try {
      await criar.mutateAsync({
        planejamento_id: planejamentoId,
        item_orcamentario_id: itemId,
        nome_custom: nomeCustom.trim() || null,
        notas: notas.trim() || undefined,
        config: {
          custo_periodicidade: periodicidade,
          // custo_unitario e receita_unitaria não são enviados — motor herda
          // de item.custo_unitario_calc e item.venda_total_calc/qtd_referencia.
          receita_modo: receitaModo,
          receita_unitaria: null,
          receita_percentual: receitaModo === 'percentual_dos_servicos' ? Number(receitaPct) : null,
          offset_dias_antes: Math.max(0, parseInt(offsetAntes || '0', 10)),
          offset_dias_depois: Math.max(0, parseInt(offsetDepois || '0', 10)),
          receita_extrapola: receitaExtrapola,
          aplica_taxas: aplicaTaxas,
          taxa_regime_id: aplicaTaxas ? taxaRegimeId : null
        }
      })
      toast.success('Tarefa indireta criada. Recalcule pra dimensioná-la.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar indireta')
    }
  }

  const semItens = itens.length === 0
  const labelPeriodo: Record<CustoPeriodicidade, string> = {
    dia: 'dia útil',
    mes: 'mês',
    ano: 'ano'
  }

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
      <DialogBody className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto">
        <DialogErrorBanner message={error} />

        {semItens ? (
          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-2xs font-mono text-warning leading-relaxed">
            Nenhum item indireto no orçamento. Cadastre indiretos em Orçamento → Indireto e
            sincronize com a planilha primeiro.
          </div>
        ) : null}

        <div>
          <Label htmlFor="ind-item">Item indireto do orçamento</Label>
          <Select
            id="ind-item"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            required
            autoFocus
          >
            <option value="">Selecione…</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} — {i.descricao}
              </option>
            ))}
          </Select>
          {itemSelecionado && itemSelecionado.venda_total != null ? (
            <div className="text-2xs text-text-dim mt-1 font-mono leading-relaxed">
              Venda orçada: {fmtBRL(itemSelecionado.venda_total)}
              {itemSelecionado.count > 0 ? (
                <span>
                  {' '}
                  · {itemSelecionado.count} tarefa
                  {itemSelecionado.count > 1 ? 's' : ''} já criada
                  {itemSelecionado.count > 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <Label htmlFor="ind-nome">Nome (opcional)</Label>
          <Input
            id="ind-nome"
            value={nomeCustom}
            onChange={(e) => setNomeCustom(e.target.value)}
            placeholder="Sobrescreve a descrição do item — ex.: Admin local"
          />
        </div>

        <div>
          <Label htmlFor="ind-period">Periodicidade do custo orçado</Label>
          <Select
            id="ind-period"
            value={periodicidade}
            onChange={(e) => setPeriodicidade(e.target.value as CustoPeriodicidade)}
          >
            <option value="dia">Dia útil</option>
            <option value="mes">Mês</option>
            <option value="ano">Ano</option>
          </Select>
          {itemSelecionado ? (
            <div className="text-2xs text-text-dim mt-1 font-mono leading-relaxed">
              Custo unitário do orçamento:{' '}
              <span className="text-text">{fmtBRL(custoUnitDerivado)}</span> por{' '}
              {labelPeriodo[periodicidade]}. Custo total = {fmtBRL(custoUnitDerivado)} × N{' '}
              {labelPeriodo[periodicidade]} cobertos pelo cronograma.
            </div>
          ) : (
            <div className="text-2xs text-text-dim mt-1 font-mono">
              Como interpretar o valor cadastrado no orçamento (dia / mês / ano).
            </div>
          )}
        </div>

        <fieldset className="rounded border border-border bg-bg-elevated/40 p-3 space-y-2">
          <legend className="px-1 text-2xs uppercase tracking-wider text-text-dim font-mono">
            Receita
          </legend>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-xs font-mono cursor-pointer">
              <input
                type="radio"
                checked={receitaModo === 'mesma_logica_custo'}
                onChange={() => setReceitaModo('mesma_logica_custo')}
                className="mt-0.5"
              />
              <span>
                Mesma lógica do custo (R$ por {labelPeriodo[periodicidade]})
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs font-mono cursor-pointer">
              <input
                type="radio"
                checked={receitaModo === 'percentual_dos_servicos'}
                onChange={() => setReceitaModo('percentual_dos_servicos')}
                className="mt-0.5"
              />
              <span>Percentual do faturamento dos serviços diretos no período</span>
            </label>
          </div>
          {receitaModo === 'mesma_logica_custo' ? (
            <div className="text-2xs text-text-dim font-mono leading-relaxed bg-bg-elevated/60 rounded px-2 py-2">
              Receita por {labelPeriodo[periodicidade]}:{' '}
              <span className="text-text">{fmtBRL(receitaUnitDerivada)}</span>
              <br />
              <span className="text-text-faint">
                Derivada de venda_total / qtd_referência do item orçado. Receita total ={' '}
                {fmtBRL(receitaUnitDerivada)} × N {labelPeriodo[periodicidade]} cobertos.
              </span>
            </div>
          ) : (
            <div>
              <Label htmlFor="ind-rec-pct">% sobre faturamento dos diretos</Label>
              <div className="relative">
                <Input
                  id="ind-rec-pct"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  max={100}
                  value={receitaPct}
                  onChange={(e) => setReceitaPct(e.target.value)}
                  required
                  className="text-right font-mono tabular-nums pr-7"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-2xs font-mono text-text-dim">
                  %
                </span>
              </div>
            </div>
          )}
          <label className="flex items-start gap-2 text-2xs font-mono cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={receitaExtrapola}
              onChange={(e) => setReceitaExtrapola(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-text">Receita acompanha período integral</span>
              <span className="text-text-dim block leading-relaxed">
                Desmarque pra capar a receita em <code>venda_total</code> do item orçado quando o
                cronograma extrapolar o orçamento (custo cresce, receita trava).
              </span>
            </span>
          </label>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ind-off-antes">Começa N dias úteis antes</Label>
            <Input
              id="ind-off-antes"
              type="number"
              inputMode="numeric"
              min={0}
              value={offsetAntes}
              onChange={(e) => setOffsetAntes(e.target.value)}
              className="text-right font-mono tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="ind-off-depois">Termina N dias úteis depois</Label>
            <Input
              id="ind-off-depois"
              type="number"
              inputMode="numeric"
              min={0}
              value={offsetDepois}
              onChange={(e) => setOffsetDepois(e.target.value)}
              className="text-right font-mono tabular-nums"
            />
          </div>
        </div>

        <fieldset className="rounded border border-border bg-bg-elevated/40 p-3 space-y-2">
          <legend className="px-1 text-2xs uppercase tracking-wider text-text-dim font-mono">
            Taxas
          </legend>
          <label className="flex items-start gap-2 text-xs font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={aplicaTaxas}
              onChange={(e) => setAplicaTaxas(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Aplicar taxas (regime) sobre o faturamento como custo
            </span>
          </label>
          {aplicaTaxas ? (
            <div>
              <Label htmlFor="ind-taxa">Regime de taxas</Label>
              <Select
                id="ind-taxa"
                value={taxaRegimeId}
                onChange={(e) => setTaxaRegimeId(e.target.value)}
                required
              >
                <option value="">— escolher —</option>
                {taxasAtivas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome} ({(Number(t.total_perc_calc) * 100).toFixed(2)}%)
                  </option>
                ))}
              </Select>
              {taxasAtivas.length === 0 ? (
                <div className="text-2xs text-warning mt-1 font-mono">
                  Nenhuma taxa ativa nesta obra. Cadastre em Orçamento → Taxas.
                </div>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <div>
          <Label htmlFor="ind-notas">Notas (opcional)</Label>
          <Input
            id="ind-notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Contexto, referência contratual, etc."
          />
        </div>

        <div className="mt-auto text-2xs text-text-dim font-mono pt-2 border-t border-border leading-relaxed">
          A tarefa indireta cobre todo o cronograma automaticamente (com offsets opcionais). Recalcule
          pra dimensionar — datas só aparecem após existir alguma tarefa direta no plano.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={criar.isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="default" size="sm" disabled={criar.isPending}>
          {criar.isPending ? 'Criando…' : 'Adicionar indireta'}
        </Button>
      </DialogFooter>
    </form>
  )
}
