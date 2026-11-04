/**
 * Marcos do plano (os `Milestone` do ApeX): uma janela de datas (início opcional, fim) em que as tarefas incluídas
 * devem caber. Incluídas = as escolhidas uma a uma, mais as que passam nos filtros por serviço, recurso e faixa de
 * estacas; as excluídas saem sempre. Tarefas que começam antes do início ou terminam depois do fim recebem bandeira.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../hooks/calculo'
import { traduzirErro, useExcluirMarco, useSalvarMarco, type CamposMarco } from '../hooks/edicao'
import type { MarcoEntrada } from '../motor/tipos'
import { fmtDataLonga, lerEstaca, textoEstaca } from '../visoes/formato'
import { isoParaSeg } from '../motor/tempo'
import { Caixa, Campo, Secao } from './campos'
import { doInputDataHora, paraInputDataHora } from './campos-util'

interface Props {
  calc: CalculoCronograma
  aberto: boolean
  somenteLeitura: boolean
  onFechar: () => void
}

export function MarcosDialog({ calc, aberto, somenteLeitura, onFechar }: Props): ReactNode {
  return (
    <Dialog open={aberto && !!calc.entrada} onOpenChange={(o) => !o && onFechar()} size="xl">
      {aberto && calc.entrada ? (
        <Conteudo calc={calc} somenteLeitura={somenteLeitura} onFechar={onFechar} />
      ) : null}
    </Dialog>
  )
}

const VAZIO: CamposMarco = {
  nome: '',
  inicio: null,
  fim: null,
  filtro_servicos: false,
  servicos: [],
  filtro_recursos: false,
  recursos: [],
  filtro_estacas: false,
  faixas: [],
  incluidas: [],
  excluidas: []
}

function Conteudo({ calc, somenteLeitura, onFechar }: Omit<Props, 'aberto'>): ReactNode {
  const e = calc.entrada!
  const [selId, setSelId] = useState<string | 'novo' | null>(e.marcos[0]?.id ?? null)
  const atual = selId && selId !== 'novo' ? e.marcos.find((m) => m.id === selId) : undefined
  return (
    <>
      <DialogHeader>
        <DialogTitle>Marcos</DialogTitle>
        <DialogDescription>
          Janelas de datas em que as tarefas incluídas devem caber.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-[480px]">
        <div className="w-60 shrink-0 space-y-1 border-r border-border p-2">
          {e.marcos.map((m) => {
            const r = calc.resultado?.marcos.find((x) => x.id === m.id)
            const viol = (r?.tarefas ?? []).some((t) =>
              calc.resultado?.tarefas
                .get(t)
                ?.violacoes.some((v) => v.tipo === 'marco' && v.marco_id === m.id)
            )
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelId(m.id)}
                className={cn(
                  'flex w-full flex-col rounded px-2 py-1.5 text-left text-xs',
                  selId === m.id ? 'bg-accent-glow text-text' : 'text-text-muted hover:bg-bg-hover'
                )}
              >
                <span className="flex items-center gap-1.5 truncate font-medium">
                  <span className="h-2 w-2 rotate-45 bg-[var(--milestone)]" />
                  {m.nome}
                  {viol ? <span className="ml-auto text-danger">⚑</span> : null}
                </span>
                <span className="text-2xs text-text-dim">
                  {m.fim ? `até ${fmtDataLonga(isoParaSeg(m.fim))}` : 'sem fim'} ·{' '}
                  {r?.tarefas.length ?? 0} tarefa(s)
                </span>
              </button>
            )
          })}
          {!somenteLeitura ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setSelId('novo')}
            >
              <Plus size={12} /> Novo marco
            </Button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          {selId ? (
            <FormMarco
              key={selId}
              calc={calc}
              marco={atual}
              somenteLeitura={somenteLeitura}
              onSalvo={(id) => setSelId(id)}
              onExcluido={() => setSelId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-text-dim">
              Nenhum marco.
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  )
}

function FormMarco({
  calc,
  marco,
  somenteLeitura,
  onSalvo,
  onExcluido
}: {
  calc: CalculoCronograma
  marco: MarcoEntrada | undefined
  somenteLeitura: boolean
  onSalvo: (id: string) => void
  onExcluido: () => void
}): ReactNode {
  const e = calc.entrada!
  const [f, setF] = useState<CamposMarco>(marco ? { ...VAZIO, ...marco } : VAZIO)
  const [faixasTxt, setFaixasTxt] = useState(
    (marco?.faixas ?? []).map((x) => {
      const tr = e.trechos.find((t) => t.id === x.trecho_id)
      return {
        trecho_id: x.trecho_id,
        ini: textoEstaca(x.inicio_m, tr),
        fim: textoEstaca(x.fim_m, tr)
      }
    })
  )
  const [erro, setErro] = useState<string | null>(null)
  const salvar = useSalvarMarco()
  const excluir = useExcluirMarco()
  const confirmar = useConfirm()
  const ro = somenteLeitura
  const tarefas = useMemo(
    () =>
      e.tarefas
        .filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [e.tarefas]
  )
  const recursos = useMemo(() => {
    const m = new Map<string, string>()
    for (const q of e.equipes) for (const r of q.recursos) m.set(r.recurso_id, r.nome)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [e.equipes])
  const incluidasCalc = calc.resultado?.marcos.find((m) => m.id === marco?.id)?.tarefas ?? []
  const set = (x: Partial<CamposMarco>): void => setF({ ...f, ...x })
  const alterna = (lista: string[], id: string, on: boolean): string[] =>
    on ? [...new Set([...lista, id])] : lista.filter((x) => x !== id)

  const gravar = async (): Promise<void> => {
    setErro(null)
    if (!f.nome.trim()) return setErro('Informe o nome do marco.')
    if (!f.fim && !f.inicio) return setErro('Informe ao menos o fim da janela.')
    if (f.inicio && f.fim && f.inicio > f.fim)
      return setErro('O início da janela não pode ser depois do fim.')
    const faixas: CamposMarco['faixas'] = []
    for (const [k, x] of faixasTxt.entries()) {
      const tr = e.trechos.find((t) => t.id === x.trecho_id)
      const a = lerEstaca(x.ini, tr),
        b = lerEstaca(x.fim, tr)
      if (a === null || b === null || a === b) return setErro(`Faixa ${k + 1}: estacas inválidas.`)
      faixas.push({ trecho_id: x.trecho_id, inicio_m: Math.min(a, b), fim_m: Math.max(a, b) })
    }
    if (f.filtro_estacas && !faixas.length)
      return setErro('Com o filtro de estacas, informe ao menos uma faixa.')
    try {
      const id = await salvar.mutateAsync({
        planejamentoId: e.plano.id,
        id: marco?.id ?? null,
        campos: { ...f, nome: f.nome.trim(), faixas }
      })
      toast.success('Marco salvo.')
      onSalvo(id)
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <DialogBody className="max-h-[56vh] flex-1 space-y-4 overflow-y-auto">
        <DialogErrorBanner message={erro} />
        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="Nome" className="col-span-3">
            <Input value={f.nome} onChange={(x) => set({ nome: x.target.value })} disabled={ro} />
          </Campo>
          <Campo rotulo="Início da janela (opcional)">
            <Input
              type="datetime-local"
              value={paraInputDataHora(f.inicio)}
              onChange={(x) => set({ inicio: doInputDataHora(x.target.value) })}
              disabled={ro}
            />
          </Campo>
          <Campo rotulo="Fim da janela">
            <Input
              type="datetime-local"
              value={paraInputDataHora(f.fim)}
              onChange={(x) => set({ fim: doInputDataHora(x.target.value) })}
              disabled={ro}
            />
          </Campo>
          <div className="flex items-end pb-1 text-2xs text-text-dim">
            {marco ? `${incluidasCalc.length} tarefa(s) incluída(s) no último cálculo` : ''}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Secao titulo="Tarefas">
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {tarefas.map((t) => {
                const inc = f.incluidas.includes(t.id),
                  exc = f.excluidas.includes(t.id)
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        'flex-1 truncate',
                        incluidasCalc.includes(t.id) ? 'text-text' : 'text-text-dim'
                      )}
                    >
                      {t.nome}
                    </span>
                    <Select
                      value={inc ? 'inc' : exc ? 'exc' : ''}
                      disabled={ro}
                      className="h-6 w-32"
                      onChange={(x) =>
                        set({
                          incluidas: alterna(f.incluidas, t.id, x.target.value === 'inc'),
                          excluidas: alterna(f.excluidas, t.id, x.target.value === 'exc')
                        })
                      }
                    >
                      <option value="">pelos filtros</option>
                      <option value="inc">sempre incluir</option>
                      <option value="exc">sempre excluir</option>
                    </Select>
                  </div>
                )
              })}
            </div>
          </Secao>
          <div className="space-y-4">
            <Secao titulo="Filtro por serviço">
              <Caixa
                marcado={f.filtro_servicos}
                onMudar={(v) => set({ filtro_servicos: v })}
                desabilitado={ro}
              >
                Incluir as tarefas destes serviços
              </Caixa>
              {f.filtro_servicos ? (
                <div className="max-h-28 space-y-1 overflow-y-auto pl-5">
                  {e.servicos
                    .filter((s) => e.tarefas.some((t) => t.servico_id === s.id))
                    .map((s) => (
                      <Caixa
                        key={s.id}
                        marcado={f.servicos.includes(s.id)}
                        desabilitado={ro}
                        onMudar={(v) => set({ servicos: alterna(f.servicos, s.id, v) })}
                      >
                        {s.codigo} {s.nome}
                      </Caixa>
                    ))}
                </div>
              ) : null}
            </Secao>
            <Secao titulo="Filtro por recurso">
              <Caixa
                marcado={f.filtro_recursos}
                onMudar={(v) => set({ filtro_recursos: v })}
                desabilitado={ro}
              >
                Incluir as tarefas cujas equipes usam estes recursos
              </Caixa>
              {f.filtro_recursos ? (
                <div className="max-h-28 space-y-1 overflow-y-auto pl-5">
                  {recursos.map(([id, nome]) => (
                    <Caixa
                      key={id}
                      marcado={f.recursos.includes(id)}
                      desabilitado={ro}
                      onMudar={(v) => set({ recursos: alterna(f.recursos, id, v) })}
                    >
                      {nome}
                    </Caixa>
                  ))}
                </div>
              ) : null}
            </Secao>
            <Secao titulo="Filtro por estacas">
              <Caixa
                marcado={f.filtro_estacas}
                onMudar={(v) => set({ filtro_estacas: v })}
                desabilitado={ro}
              >
                Incluir as tarefas que passam nestas faixas
              </Caixa>
              {f.filtro_estacas ? (
                <div className="space-y-1 pl-5">
                  {faixasTxt.map((x, k) => (
                    <div key={k} className="flex items-center gap-1">
                      <Select
                        value={x.trecho_id}
                        onChange={(v) =>
                          setFaixasTxt(
                            faixasTxt.map((y, j) =>
                              j === k ? { ...y, trecho_id: v.target.value } : y
                            )
                          )
                        }
                        disabled={ro}
                        className="h-6"
                      >
                        {e.trechos
                          .filter((t) => t.tipo === 'eixo')
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nome}
                            </option>
                          ))}
                      </Select>
                      <Input
                        value={x.ini}
                        onChange={(v) =>
                          setFaixasTxt(
                            faixasTxt.map((y, j) => (j === k ? { ...y, ini: v.target.value } : y))
                          )
                        }
                        disabled={ro}
                        className="h-6 w-24"
                        placeholder="de"
                      />
                      <Input
                        value={x.fim}
                        onChange={(v) =>
                          setFaixasTxt(
                            faixasTxt.map((y, j) => (j === k ? { ...y, fim: v.target.value } : y))
                          )
                        }
                        disabled={ro}
                        className="h-6 w-24"
                        placeholder="até"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={ro}
                        onClick={() => setFaixasTxt(faixasTxt.filter((_, j) => j !== k))}
                        aria-label="Remover faixa"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ro || !e.trechos.some((t) => t.tipo === 'eixo')}
                    onClick={() =>
                      setFaixasTxt([
                        ...faixasTxt,
                        {
                          trecho_id: e.trechos.find((t) => t.tipo === 'eixo')!.id,
                          ini: '',
                          fim: ''
                        }
                      ])
                    }
                  >
                    <Plus size={12} /> Faixa
                  </Button>
                </div>
              ) : null}
            </Secao>
          </div>
        </div>
      </DialogBody>
      {!ro ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2">
          {marco ? (
            <Button
              variant="danger"
              size="sm"
              disabled={excluir.isPending}
              onClick={async () => {
                if (
                  !(await confirmar({
                    title: 'Remover o marco?',
                    confirmLabel: 'Remover',
                    variant: 'danger'
                  }))
                )
                  return
                excluir.mutate(
                  { planejamentoId: e.plano.id, id: marco.id },
                  { onSuccess: onExcluido, onError: (x) => setErro(traduzirErro(x.message)) }
                )
              }}
            >
              Remover marco
            </Button>
          ) : null}
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => void gravar()}
            disabled={salvar.isPending}
          >
            {salvar.isPending ? 'Salvando…' : marco ? 'Salvar marco' : 'Criar marco'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
