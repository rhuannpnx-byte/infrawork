import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PinOff, Trash2, Plus } from 'lucide-react'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { TabPill } from '@/components/ui/TabPill'
import { fmtBRL, fmtQtd } from '@/lib/money'
import { formatNumber, formatPosicao, parsePosicao } from '@/lib/format'
import type {
  PlanejamentoTarefaCompleta,
  Equipe,
  PerfilNome,
  SemanaPerfil
} from '@/types/planejamento'
import { DEPENDENCIA_LABEL, PERFIL_LABEL, PERFIL_NOMES } from '@/types/planejamento'
import { fmtDataBR } from '../lib/dates'
import {
  useUpdateTarefa,
  useAlocarEquipe,
  useDesalocarEquipe,
  useDeleteDependencia,
  useDeleteTarefa,
  useSalvarPerfilCustomizado,
  useReverterParaPerfilDefault
} from '../hooks'
import { EquipeChip } from './EquipeChip'
import { useProducaoPorTarefa } from '@/features/acompanhamento/hooks/producao'
import { useConfirm } from '@/components/modals/ConfirmDialog'

type Tab =
  | 'datas'
  | 'equipes'
  | 'deps'
  | 'cpu'
  | 'notas'
  | 'realizado'
  | 'localizacao'
  | 'perfil'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tarefa: PlanejamentoTarefaCompleta | null
  tarefas: PlanejamentoTarefaCompleta[]
  equipes: Equipe[]
  readOnly: boolean
  onAddDependencia: () => void
}

export function TarefaDetailPanel({
  open,
  onOpenChange,
  tarefa,
  tarefas,
  equipes,
  readOnly,
  onAddDependencia
}: Props): ReactNode {
  const [tab, setTab] = useState<Tab>('datas')
  const [equipeSel, setEquipeSel] = useState('')
  const [qtdEq, setQtdEq] = useState(1)
  const [notasDraft, setNotasDraft] = useState('')

  const updateTarefa = useUpdateTarefa()
  const alocar = useAlocarEquipe()
  const desalocar = useDesalocarEquipe()
  const delDep = useDeleteDependencia()
  const delTarefa = useDeleteTarefa()
  const confirm = useConfirm()

  if (!tarefa) return null

  const tarefasPorId = new Map(tarefas.map((t) => [t.id, t]))

  const TAB_CLASS = 'flex-1 uppercase tracking-wider'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="w-[480px]">
      <SheetHeader>
        <div className="text-2xs font-mono text-text-dim mb-1">
          {tarefa.servico_grupo_codigo}
        </div>
        <SheetTitle>{tarefa.servico_grupo_descricao}</SheetTitle>
      </SheetHeader>

      <div className="flex border-b border-border" role="tablist">
        <TabPill active={tab === 'datas'} onClick={() => setTab('datas')} className={TAB_CLASS}>
          Datas
        </TabPill>
        <TabPill active={tab === 'equipes'} onClick={() => setTab('equipes')} className={TAB_CLASS}>
          Equipes
        </TabPill>
        <TabPill active={tab === 'deps'} onClick={() => setTab('deps')} className={TAB_CLASS}>
          Deps
        </TabPill>
        <TabPill active={tab === 'cpu'} onClick={() => setTab('cpu')} className={TAB_CLASS}>
          CPU
        </TabPill>
        <TabPill
          active={tab === 'notas'}
          onClick={() => {
            setNotasDraft(tarefa.notas ?? '')
            setTab('notas')
          }}
          className={TAB_CLASS}
        >
          Notas
        </TabPill>
        <TabPill active={tab === 'localizacao'} onClick={() => setTab('localizacao')} className={TAB_CLASS}>
          Local
        </TabPill>
        <TabPill active={tab === 'perfil'} onClick={() => setTab('perfil')} className={TAB_CLASS}>
          Perfil
        </TabPill>
        <TabPill active={tab === 'realizado'} onClick={() => setTab('realizado')} className={TAB_CLASS}>
          Realizado
        </TabPill>
      </div>

      <SheetBody className="space-y-3 text-xs">
        {tab === 'datas' ? (
          <div className="space-y-3 font-mono">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início">{fmtDataBR(tarefa.data_inicio)}</Field>
              <Field label="Fim">{fmtDataBR(tarefa.data_fim)}</Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duração">
                {tarefa.duracao_dias_uteis_calc
                  ? `${Math.ceil(tarefa.duracao_dias_uteis_calc)} dias úteis`
                  : '—'}
              </Field>
              <Field label="Quantidade">
                {fmtQtd(tarefa.quantidade_referencia)} {tarefa.unidade_servico ?? ''}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Produção CPU">
                {tarefa.producao_diaria_qtde
                  ? `${fmtQtd(tarefa.producao_diaria_qtde)} ${tarefa.producao_diaria_unidade ?? '/dia'}`
                  : '—'}
              </Field>
              <Field label="Custo total">{fmtBRL(tarefa.custo_total_tarefa)}</Field>
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              {tarefa.data_inicio_manual ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readOnly}
                  onClick={async () => {
                    await updateTarefa.mutateAsync({
                      id: tarefa.id,
                      planejamento_id: tarefa.planejamento_id,
                      data_inicio_manual: false
                    })
                    toast.success('Data desafixada. Será recalculada.')
                  }}
                >
                  <PinOff size={11} /> Desafixar data de início
                </Button>
              ) : (
                <div className="text-2xs text-text-dim font-mono">
                  Data calculada automaticamente. Pra fixar, edite no Gantt.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'equipes' ? (
          <div className="space-y-3">
            <div>
              <div className="text-2xs font-mono text-text-dim uppercase mb-1">Alocadas</div>
              {tarefa.equipes.length === 0 ? (
                <div className="text-text-dim italic">Sem equipe alocada. Duração será 0.</div>
              ) : (
                <div className="space-y-1.5">
                  {tarefa.equipes.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <EquipeChip nome={e.nome} cor={e.cor} qtd={e.qtd_equipes} />
                      {!readOnly ? (
                        <IconButton
                          size="sm"
                          variant="danger"
                          aria-label={`Remover equipe ${e.nome}`}
                          onClick={() =>
                            desalocar.mutate({
                              tarefa_id: tarefa.id,
                              equipe_id: e.id,
                              planejamento_id: tarefa.planejamento_id
                            })
                          }
                        >
                          <Trash2 size={11} />
                        </IconButton>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!readOnly ? (
              <div className="pt-2 border-t border-border space-y-2">
                <Label htmlFor="alocar-eq">Alocar equipe</Label>
                <select
                  id="alocar-eq"
                  value={equipeSel}
                  onChange={(e) => setEquipeSel(e.target.value)}
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
                >
                  <option value="">Selecione…</option>
                  {equipes
                    .filter((e) => !tarefa.equipes.some((ea) => ea.id === e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome} · {e.tipo}
                      </option>
                    ))}
                </select>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="alocar-qtd">Qtd equipes</Label>
                    <Input
                      id="alocar-qtd"
                      type="number"
                      min={1}
                      max={10}
                      value={qtdEq}
                      onChange={(e) => setQtdEq(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!equipeSel}
                    onClick={async () => {
                      await alocar.mutateAsync({
                        tarefa_id: tarefa.id,
                        equipe_id: equipeSel,
                        qtd_equipes: qtdEq,
                        planejamento_id: tarefa.planejamento_id
                      })
                      setEquipeSel('')
                      setQtdEq(1)
                      toast.success('Equipe alocada.')
                    }}
                  >
                    <Plus size={11} /> Alocar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'deps' ? (
          <div className="space-y-3">
            <div>
              <div className="text-2xs font-mono text-text-dim uppercase mb-1">Predecessoras</div>
              {tarefa.predecessoras.length === 0 ? (
                <div className="text-text-dim italic">Sem predecessoras.</div>
              ) : (
                <div className="space-y-1.5">
                  {tarefa.predecessoras.map((p) => {
                    const pred = tarefasPorId.get(p.predecessora_id)
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 px-2 py-1 bg-bg rounded border border-border text-2xs font-mono"
                      >
                        <span className="text-text-dim">{DEPENDENCIA_LABEL[p.tipo]}</span>
                        <span className="flex-1 truncate">
                          {pred?.servico_grupo_codigo} {pred?.servico_grupo_descricao}
                        </span>
                        <span className="text-text-dim">lag {p.lag_dias}d</span>
                        {!readOnly ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            aria-label="Remover dependência"
                            onClick={() =>
                              delDep.mutate({
                                id: p.id,
                                planejamento_id: tarefa.planejamento_id
                              })
                            }
                          >
                            <Trash2 size={10} />
                          </IconButton>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-2xs font-mono text-text-dim uppercase mb-1">Sucessoras</div>
              {tarefa.sucessoras.length === 0 ? (
                <div className="text-text-dim italic">Sem sucessoras.</div>
              ) : (
                <div className="space-y-1.5">
                  {tarefa.sucessoras.map((s) => {
                    const suc = tarefasPorId.get(s.sucessora_id)
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 px-2 py-1 bg-bg rounded border border-border text-2xs font-mono"
                      >
                        <span className="text-text-dim">{DEPENDENCIA_LABEL[s.tipo]}</span>
                        <span className="flex-1 truncate">
                          {suc?.servico_grupo_codigo} {suc?.servico_grupo_descricao}
                        </span>
                        <span className="text-text-dim">lag {s.lag_dias}d</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {!readOnly ? (
              <Button size="sm" variant="default" onClick={onAddDependencia}>
                <Plus size={11} /> Adicionar dependência
              </Button>
            ) : null}
          </div>
        ) : null}

        {tab === 'cpu' ? (
          <div className="space-y-2 font-mono">
            <Field label="Serviço">
              {tarefa.servico_codigo} — {tarefa.servico_nome}
            </Field>
            <Field label="Unidade">{tarefa.unidade_servico ?? '—'}</Field>
            <Field label="Custo unitário">{fmtBRL(tarefa.custo_unit_snapshot)}</Field>
            <Field label="Produção diária">
              {tarefa.producao_diaria_qtde
                ? `${fmtQtd(tarefa.producao_diaria_qtde)} ${tarefa.producao_diaria_unidade ?? ''}`
                : '—'}
            </Field>
            {!tarefa.cpu_snapshot_id ? (
              <div className="text-amber-400 text-2xs">
                Servico_grupo sem CPU vinculada. Vincule no orçamento antes de
                planejar essa tarefa.
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'notas' ? (
          <div className="space-y-2">
            <Label htmlFor="notas">Notas</Label>
            <textarea
              id="notas"
              value={notasDraft}
              onChange={(e) => setNotasDraft(e.target.value)}
              rows={6}
              readOnly={readOnly}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            />
            {!readOnly ? (
              <Button
                size="sm"
                variant="default"
                onClick={async () => {
                  await updateTarefa.mutateAsync({
                    id: tarefa.id,
                    planejamento_id: tarefa.planejamento_id,
                    notas: notasDraft.trim() || null
                  })
                  toast.success('Notas salvas.')
                }}
              >
                Salvar notas
              </Button>
            ) : null}
          </div>
        ) : null}

        {tab === 'localizacao' ? (
          <LocalizacaoTab
            tarefa={tarefa}
            readOnly={readOnly}
            onSave={async ({ inicio, fim }) => {
              // Sempre envia OS DOIS campos atomicamente — o constraint
              // chk_plan_tar_pos_par exige (inicio IS NULL) = (fim IS NULL).
              await updateTarefa.mutateAsync({
                id: tarefa.id,
                planejamento_id: tarefa.planejamento_id,
                posicao_inicio_m: inicio,
                posicao_fim_m: fim
              })
            }}
          />
        ) : null}

        {tab === 'perfil' ? (
          <PerfilTab tarefa={tarefa} readOnly={readOnly} confirm={confirm} />
        ) : null}

        {tab === 'realizado' ? <RealizadoTab tarefaId={tarefa.id} /> : null}
      </SheetBody>
      <SheetFooter>
        {!readOnly ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const ok = await confirm({
                title: 'Remover esta tarefa?',
                description: 'A tarefa será removida do planejamento.',
                confirmLabel: 'Remover',
                variant: 'danger'
              })
              if (!ok) return
              await delTarefa.mutateAsync({
                id: tarefa.id,
                planejamento_id: tarefa.planejamento_id
              })
              toast.success('Tarefa removida.')
              onOpenChange(false)
            }}
          >
            <Trash2 size={11} /> Remover
          </Button>
        ) : (
          <span className="text-2xs text-text-dim font-mono">Somente leitura</span>
        )}
        <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <div className="text-2xs uppercase text-text-dim font-mono mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// LocalizacaoTab: eixo espacial (posição em km/m/estaca conforme unidade
// efetiva da tarefa). Armazenamento sempre em METROS; conversão visual
// via formatPosicao/parsePosicao. Inputs validados onBlur — input vazio
// limpa o valor (null). Os dois campos seguem a regra "ambos null ou
// ambos preenchidos" do banco; UI espelha isso permitindo null em ambos
// individualmente, e o save no DB falha se quebrar a CHECK constraint.
// ─────────────────────────────────────────────────────────────────────────
function LocalizacaoTab({
  tarefa,
  readOnly,
  onSave
}: {
  tarefa: PlanejamentoTarefaCompleta
  readOnly: boolean
  onSave: (input: { inicio: number | null; fim: number | null }) => Promise<void>
}): ReactNode {
  const unidade = tarefa.unidade_espaco_efetiva
  const [iniDraft, setIniDraft] = useState(formatPosicao(tarefa.posicao_inicio_m, unidade))
  const [fimDraft, setFimDraft] = useState(formatPosicao(tarefa.posicao_fim_m, unidade))
  const [erro, setErro] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-sync quando troca tarefa ou unidade efetiva
  useEffect(() => {
    setIniDraft(formatPosicao(tarefa.posicao_inicio_m, unidade))
    setFimDraft(formatPosicao(tarefa.posicao_fim_m, unidade))
    setErro(null)
  }, [tarefa.id, tarefa.posicao_inicio_m, tarefa.posicao_fim_m, unidade])

  // Live previews: mostra abaixo de cada input o valor parseado em formato
  // canônico. Ajuda o user a entender o que vai salvar enquanto digita.
  const iniTrim = iniDraft.trim()
  const fimTrim = fimDraft.trim()
  const iniParsed = iniTrim === '' ? null : parsePosicao(iniTrim, unidade)
  const fimParsed = fimTrim === '' ? null : parsePosicao(fimTrim, unidade)
  const iniPreview = iniParsed !== null ? formatPosicao(iniParsed, unidade) : null
  const fimPreview = fimParsed !== null ? formatPosicao(fimParsed, unidade) : null

  const placeholder =
    unidade === 'km' ? '2+508,50' : unidade === 'estaca' ? 'EST 125+8,50' : '2508,50'
  const helperFormato =
    unidade === 'km'
      ? 'Formato km: KM+M,CC  (ex: 2+508,50 = 2,5 km).  M entre 0 e 999.'
      : unidade === 'estaca'
        ? 'Formato estaca: [EST] N+M,CC  (ex: EST 125+8,50).  Cada estaca = 20 m. Offset entre 0 e 19,99.'
        : 'Formato m: número com vírgula ou ponto decimal (ex: 2508,50).'

  const iniInvalido = iniTrim !== '' && iniParsed === null
  const fimInvalido = fimTrim !== '' && fimParsed === null
  const mismatch = iniTrim === '' ? fimTrim !== '' : fimTrim === ''
  const ordemInvertida =
    iniParsed !== null && fimParsed !== null && fimParsed < iniParsed
  const podeSalvar =
    !readOnly && !saving && !iniInvalido && !fimInvalido && !mismatch && !ordemInvertida

  async function salvar(): Promise<void> {
    setErro(null)
    // Caso 1: ambos vazios → limpa as duas posições.
    if (iniTrim === '' && fimTrim === '') {
      setSaving(true)
      try {
        await onSave({ inicio: null, fim: null })
      } catch (e) {
        setErro('Falha ao salvar: ' + (e as Error).message)
      } finally {
        setSaving(false)
      }
      return
    }
    // Caso 2: validações
    if (iniInvalido) {
      setErro('Início: formato inválido pra unidade ' + unidade + '.')
      return
    }
    if (fimInvalido) {
      setErro('Fim: formato inválido pra unidade ' + unidade + '.')
      return
    }
    if (mismatch) {
      setErro('Preencha os DOIS campos (ou apague os dois). Tarefa puramente temporal = ambos vazios.')
      return
    }
    if (ordemInvertida) {
      setErro('Fim não pode ser antes de Início.')
      return
    }
    // Caso 3: ambos válidos → salva
    setSaving(true)
    try {
      await onSave({ inicio: iniParsed, fim: fimParsed })
    } catch (e) {
      setErro('Falha ao salvar: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function limpar(): void {
    setIniDraft('')
    setFimDraft('')
    setErro(null)
  }

  const sujo =
    iniDraft !== formatPosicao(tarefa.posicao_inicio_m, unidade) ||
    fimDraft !== formatPosicao(tarefa.posicao_fim_m, unidade)

  return (
    <div className="space-y-3 font-mono text-xs">
      <div className="text-2xs text-text-dim leading-relaxed">
        Unidade desta tarefa: <span className="text-text">{unidade}</span>
        {tarefa.unidade_espaco_display
          ? ' (sobrescrita da obra)'
          : ' (padrão da obra)'}
        .
        <br />
        {helperFormato}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="pos-ini">Início</Label>
          <Input
            id="pos-ini"
            value={iniDraft}
            placeholder={placeholder}
            disabled={readOnly}
            onChange={(e) => setIniDraft(e.target.value)}
            aria-invalid={iniInvalido}
            className={iniInvalido ? 'border-danger' : ''}
          />
          <div className="text-2xs mt-1 h-3">
            {iniInvalido ? (
              <span className="text-danger">formato inválido</span>
            ) : iniPreview ? (
              <span className="text-text-dim">= {iniPreview}</span>
            ) : null}
          </div>
        </div>
        <div>
          <Label htmlFor="pos-fim">Fim</Label>
          <Input
            id="pos-fim"
            value={fimDraft}
            placeholder={placeholder}
            disabled={readOnly}
            onChange={(e) => setFimDraft(e.target.value)}
            aria-invalid={fimInvalido}
            className={fimInvalido ? 'border-danger' : ''}
          />
          <div className="text-2xs mt-1 h-3">
            {fimInvalido ? (
              <span className="text-danger">formato inválido</span>
            ) : fimPreview ? (
              <span className="text-text-dim">= {fimPreview}</span>
            ) : null}
          </div>
        </div>
      </div>

      {erro ? (
        <div className="text-danger text-2xs font-mono leading-relaxed">{erro}</div>
      ) : null}

      {!readOnly ? (
        <div className="pt-2 border-t border-border flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={salvar}
            disabled={!podeSalvar || !sujo}
            title={
              !sujo
                ? 'Nenhuma mudança pra salvar'
                : !podeSalvar
                  ? 'Corrija os campos antes de salvar'
                  : 'Salvar Início e Fim (atomicamente)'
            }
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={limpar}
            disabled={!sujo && iniTrim === '' && fimTrim === ''}
            title="Apaga os dois campos (clique Salvar pra confirmar)"
          >
            Limpar
          </Button>
        </div>
      ) : null}

      <div className="pt-2 border-t border-border text-2xs text-text-dim leading-relaxed">
        Os dois campos vão juntos: ambos vazios (tarefa puramente temporal, ex:
        mobilização) ou ambos preenchidos. O banco rejeita salvar só um. Por isso o
        botão Salvar manda os dois de uma vez.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PerfilTab — edição modo planilha do perfil semanal de uma tarefa.
//
// UX:
//   * Dropdown "Shape default" + botão "Aplicar shape" (atualiza perfil_default
//     no DB; user deve clicar Recalcular cronograma manualmente pra regerar).
//   * Tabela editável célula a célula. Edição NUNCA toca outras células
//     automaticamente. Footer mostra soma vs referência em tempo real.
//   * Botão "Salvar" disabled se soma fora da tolerância 0.1%.
//   * Botão "Redistribuir saldo" recalcula uniforme nas semanas restantes.
//   * Botão "Reverter pra default" deleta perfil + flag = false (confirmação).
// ─────────────────────────────────────────────────────────────────────────
type ConfirmFn = ReturnType<typeof useConfirm>

function PerfilTab({
  tarefa,
  readOnly,
  confirm
}: {
  tarefa: PlanejamentoTarefaCompleta
  readOnly: boolean
  confirm: ConfirmFn
}): ReactNode {
  const updateTarefa = useUpdateTarefa()
  const salvarCustom = useSalvarPerfilCustomizado()
  const reverter = useReverterParaPerfilDefault()

  const ref = Number(tarefa.quantidade_referencia ?? 0)
  const tolerancia = Math.max(Math.abs(ref) * 0.001, 0.0001)

  // Estado local: shape selecionada + cópia editável das semanas.
  const [shapeSel, setShapeSel] = useState<PerfilNome>(tarefa.perfil_default)
  const [drafts, setDrafts] = useState<SemanaPerfil[]>(tarefa.perfil_semanas ?? [])

  // Sincroniza ao trocar de tarefa
  useEffect(() => {
    setShapeSel(tarefa.perfil_default)
    setDrafts(tarefa.perfil_semanas ?? [])
  }, [tarefa.id, tarefa.perfil_default, tarefa.perfil_semanas])

  const soma = drafts.reduce((acc, s) => acc + s.quantidade_planejada, 0)
  const delta = soma - ref
  const dentroTolerancia = Math.abs(delta) <= tolerancia
  const somaCor = soma === 0 ? 'text-text-dim' : dentroTolerancia ? 'text-success' : 'text-danger'

  function editCelula(idx: number, valor: number): void {
    setDrafts((cur) =>
      cur.map((s, i) =>
        i === idx ? { ...s, quantidade_planejada: Math.max(0, valor) } : s
      )
    )
  }

  function redistribuirSaldo(): void {
    // Distribui uniforme o delta entre as semanas com qty > 0 (ou todas se nenhuma).
    const semanasComProd = drafts.filter((s) => s.quantidade_planejada > 0)
    const alvo = semanasComProd.length > 0 ? semanasComProd : drafts
    if (alvo.length === 0) return
    const ajustePorSemana = -delta / alvo.length
    setDrafts((cur) =>
      cur.map((s) => {
        const aplica = alvo.includes(s)
        if (!aplica) return s
        return {
          ...s,
          quantidade_planejada: Math.max(0, s.quantidade_planejada + ajustePorSemana)
        }
      })
    )
  }

  async function aplicarShape(): Promise<void> {
    await updateTarefa.mutateAsync({
      id: tarefa.id,
      planejamento_id: tarefa.planejamento_id,
      perfil_default: shapeSel
    })
    toast.success('Shape default atualizada. Clique em "Recalcular cronograma" pra aplicar.')
  }

  async function salvar(): Promise<void> {
    try {
      await salvarCustom.mutateAsync({
        tarefa_id: tarefa.id,
        planejamento_id: tarefa.planejamento_id,
        semanas: drafts
      })
      toast.success('Perfil customizado salvo.')
    } catch (e) {
      toast.error('Falha ao salvar: ' + (e as Error).message)
    }
  }

  async function reverterDefault(): Promise<void> {
    const ok = await confirm({
      title: 'Reverter pra perfil default?',
      description:
        'O perfil customizado atual será descartado. Próximo recálculo gera ' +
        'novo perfil com base na shape default.',
      confirmLabel: 'Reverter',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await reverter.mutateAsync({
        tarefa_id: tarefa.id,
        planejamento_id: tarefa.planejamento_id
      })
      toast.success('Perfil revertido. Clique em "Recalcular cronograma".')
    } catch (e) {
      toast.error('Falha ao reverter: ' + (e as Error).message)
    }
  }

  if (drafts.length === 0) {
    return (
      <div className="space-y-3 text-xs">
        <div className="text-text-dim font-mono">
          Esta tarefa ainda não tem perfil semanal calculado. Clique em "Recalcular
          cronograma" no Gantt pra gerar com a shape default.
        </div>
        {!readOnly ? (
          <div className="pt-2 border-t border-border space-y-2">
            <Label htmlFor="shape-sel">Shape default</Label>
            <select
              id="shape-sel"
              value={shapeSel}
              onChange={(e) => setShapeSel(e.target.value as PerfilNome)}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              {PERFIL_NOMES.map((p) => (
                <option key={p} value={p}>
                  {PERFIL_LABEL[p]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={aplicarShape}
              disabled={shapeSel === tarefa.perfil_default}
            >
              Aplicar shape
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3 text-xs">
      {/* Shape default */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="shape-sel">Shape default</Label>
          <select
            id="shape-sel"
            value={shapeSel}
            disabled={readOnly}
            onChange={(e) => setShapeSel(e.target.value as PerfilNome)}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
          >
            {PERFIL_NOMES.map((p) => (
              <option key={p} value={p}>
                {PERFIL_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={aplicarShape}
          disabled={readOnly || shapeSel === tarefa.perfil_default}
        >
          Aplicar shape
        </Button>
      </div>

      {/* Tabela editável */}
      <div className="border border-border rounded overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_60px] gap-0 bg-bg-panel border-b border-border text-2xs font-mono uppercase text-text-dim">
          <div className="px-2 py-1">Semana</div>
          <div className="px-2 py-1 text-right">Quantidade</div>
          <div className="px-2 py-1 text-right">%</div>
        </div>
        <div className="max-h-[320px] overflow-y-auto divide-y divide-border">
          {drafts.map((s, idx) => {
            const pct = ref > 0 ? (s.quantidade_planejada / ref) * 100 : 0
            return (
              <div
                key={s.semana_segunda}
                className="grid grid-cols-[1fr_120px_60px] items-center text-2xs font-mono"
              >
                <div className="px-2 py-1 text-text">{s.semana_segunda}</div>
                <div className="px-2 py-0.5">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={s.quantidade_planejada}
                    disabled={readOnly}
                    onChange={(e) => editCelula(idx, Number(e.target.value))}
                    className="text-right tabular"
                  />
                </div>
                <div className="px-2 py-1 text-right text-text-dim tabular">
                  {pct.toFixed(1)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer: soma vs referência */}
      <div className={'font-mono text-2xs ' + somaCor}>
        Soma: {soma.toFixed(2)} / referência: {ref.toFixed(2)} (Δ: {delta.toFixed(2)},
        tolerância {tolerancia.toFixed(2)})
      </div>

      {/* Ações */}
      {!readOnly ? (
        <div className="pt-2 border-t border-border flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={redistribuirSaldo}
            disabled={dentroTolerancia}
            title="Distribui o delta entre as semanas com qty > 0"
          >
            Redistribuir saldo
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={salvar}
            disabled={!dentroTolerancia || salvarCustom.isPending}
            title={
              dentroTolerancia
                ? 'Salvar como perfil customizado'
                : 'Soma fora da tolerância 0.1%'
            }
          >
            Salvar customizado
          </Button>
          {tarefa.usa_perfil_customizado ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={reverterDefault}
              disabled={reverter.isPending}
              title="Descarta customização; próximo recálculo regenera com shape default"
            >
              Reverter pra default
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RealizadoTab({ tarefaId }: { tarefaId: string }): ReactNode {
  const { data: prods = [], isLoading } = useProducaoPorTarefa(tarefaId)
  if (isLoading) {
    return <div className="text-text-dim text-2xs font-mono">Carregando…</div>
  }
  if (prods.length === 0) {
    return (
      <div className="text-text-dim text-2xs font-mono leading-relaxed">
        Esta tarefa não tem produção realizada vinculada. Para começar a ver dados aqui:
        <ul className="list-disc list-inside mt-2 space-y-0.5">
          <li>Vincule a obra ao SIGA em Acompanhamento → Vínculo SIGA</li>
          <li>Vincule o serviço SIGA correspondente em Acompanhamento → Equipes → Serviços</li>
        </ul>
      </div>
    )
  }
  const total = prods.reduce((s, p) => s + Number(p.qtd ?? 0), 0)
  const dias = new Set(prods.map((p) => p.data).filter(Boolean)).size
  const ultimas = prods.slice(0, 10)
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-border bg-bg p-2">
          <div className="text-2xs uppercase text-text-dim">Realizado</div>
          <div className="text-text font-mono tabular-nums">{formatNumber(total, 0)}</div>
        </div>
        <div className="rounded border border-border bg-bg p-2">
          <div className="text-2xs uppercase text-text-dim">Registros</div>
          <div className="text-text font-mono">{prods.length}</div>
        </div>
        <div className="rounded border border-border bg-bg p-2">
          <div className="text-2xs uppercase text-text-dim">Dias com apontam.</div>
          <div className="text-text font-mono">{dias}</div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-2xs uppercase text-text-dim font-mono">Últimas produções</div>
        <div className="border border-border rounded divide-y divide-border">
          {ultimas.map((p) => (
            <div key={p.id} className="px-2 py-1.5 flex items-center gap-2 text-xs">
              <span className="size-2 rounded-sm shrink-0" style={{ background: p.equipe_display_cor ?? '#94a3b8' }} />
              <span className="font-mono text-2xs text-text-dim shrink-0 w-[72px]">{p.data ?? '—'}</span>
              <span className="truncate flex-1">{p.equipe_display_nome ?? p.siga_equipe_nome ?? '—'}</span>
              <span className="font-mono tabular-nums shrink-0">
                {formatNumber(Number(p.qtd ?? 0), 1)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
