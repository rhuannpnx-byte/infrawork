import { useState, type ReactNode } from 'react'
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
import { fmtBRL, fmtQtd } from '@/lib/money'
import type {
  PlanejamentoTarefaCompleta,
  Equipe
} from '@/types/planejamento'
import { DEPENDENCIA_LABEL } from '@/types/planejamento'
import { fmtDataBR } from '../lib/dates'
import {
  useUpdateTarefa,
  useAlocarEquipe,
  useDesalocarEquipe,
  useDeleteDependencia,
  useDeleteTarefa
} from '../hooks'
import { EquipeChip } from './EquipeChip'
import { useProducaoPorTarefa } from '@/features/acompanhamento/hooks/producao'
import { useConfirm } from '@/components/modals/ConfirmDialog'

type Tab = 'datas' | 'equipes' | 'deps' | 'cpu' | 'notas' | 'realizado'

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

  const tabClass = (t: Tab): string =>
    `flex-1 text-xs font-mono uppercase tracking-wider py-2 ${
      tab === t ? 'border-b-2 border-accent text-accent' : 'text-text-dim hover:text-text'
    }`

  const tarefasPorId = new Map(tarefas.map((t) => [t.id, t]))

  return (
    <Sheet open={open} onOpenChange={onOpenChange} className="w-[480px]">
      <SheetHeader>
        <div className="text-2xs font-mono text-text-dim mb-1">
          {tarefa.servico_grupo_codigo}
        </div>
        <SheetTitle>{tarefa.servico_grupo_descricao}</SheetTitle>
      </SheetHeader>

      <div className="flex border-b border-border">
        <button type="button" className={tabClass('datas')} onClick={() => setTab('datas')}>
          Datas
        </button>
        <button type="button" className={tabClass('equipes')} onClick={() => setTab('equipes')}>
          Equipes
        </button>
        <button type="button" className={tabClass('deps')} onClick={() => setTab('deps')}>
          Deps
        </button>
        <button type="button" className={tabClass('cpu')} onClick={() => setTab('cpu')}>
          CPU
        </button>
        <button
          type="button"
          className={tabClass('notas')}
          onClick={() => {
            setNotasDraft(tarefa.notas ?? '')
            setTab('notas')
          }}
        >
          Notas
        </button>
        <button type="button" className={tabClass('realizado')} onClick={() => setTab('realizado')}>
          Realizado
        </button>
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
                    toast.success('Data desafixada — será recalculada.')
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
                <div className="text-text-dim italic">Sem equipe alocada — duração será 0.</div>
              ) : (
                <div className="space-y-1.5">
                  {tarefa.equipes.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <EquipeChip nome={e.nome} cor={e.cor} qtd={e.qtd_equipes} />
                      {!readOnly ? (
                        <button
                          type="button"
                          className="text-text-dim hover:text-red-400"
                          onClick={() =>
                            desalocar.mutate({
                              tarefa_id: tarefa.id,
                              equipe_id: e.id,
                              planejamento_id: tarefa.planejamento_id
                            })
                          }
                        >
                          <Trash2 size={11} />
                        </button>
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
                          <button
                            type="button"
                            className="text-text-dim hover:text-red-400"
                            onClick={() =>
                              delDep.mutate({
                                id: p.id,
                                planejamento_id: tarefa.planejamento_id
                              })
                            }
                          >
                            <Trash2 size={10} />
                          </button>
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
          <div className="text-text font-mono tabular-nums">{total.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
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
                {Number(p.qtd ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
