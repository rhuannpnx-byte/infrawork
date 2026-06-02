// Painel de vinculação de CPUs a um servico-agregador.
//
// Cada vínculo: CPU + fator (divisor da unidade) + ordem + observação.
// Custo unitário do serviço = Σ (cpu.custo_unit_calc / fator).
// A produção diária pode ser editada (herda da 1ª CPU vinculada se NULL).

import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCpus } from '@/features/orcamento/hooks/cpus'
import {
  useServicoCpuLinks,
  useUpsertServicoCpuLink,
  useDeleteServicoCpuLink,
  useUpdateServicoProducao
} from '@/features/orcamento/hooks/servico-links'
import { fmtBRL4 } from '@/lib/money'
import { parseBR } from '@/lib/money'
import { formatNumber } from '@/lib/format/number'
import { cn } from '@/lib/utils'
import { nomeDaCpu } from '../lib/nomeDaCpu'
import type { Servico, ServicoCpuOperacao } from '@/types/orcamento'

/** Aplica operação ao custo da CPU usando o fator. */
function aplicarOp(custo: number, fator: number, op: ServicoCpuOperacao): number {
  if (!isFinite(fator) || fator === 0) return 0
  return op === 'multiplicar' ? custo * fator : custo / fator
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  servico: Servico | null
  obraId: string
}

export function ServicoCpuLinksDialog({ open, onOpenChange, servico, obraId }: Props): ReactNode {
  if (!servico) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <ServicoCpuLinksDialogContent
        key={servico.id}
        servico={servico}
        obraId={obraId}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  )
}

function ServicoCpuLinksDialogContent({
  servico,
  obraId,
  onClose
}: {
  servico: Servico
  obraId: string
  onClose: () => void
}): ReactNode {
  const { data: links = [] } = useServicoCpuLinks(servico.id)
  const { data: cpus = [] } = useCpus(obraId)
  const upsertLink = useUpsertServicoCpuLink()
  const deleteLink = useDeleteServicoCpuLink()
  const updateProducao = useUpdateServicoProducao()
  const confirm = useConfirm()

  const [novoCpuId, setNovoCpuId] = useState('')
  const [novoFator, setNovoFator] = useState('1')
  const [novoOp, setNovoOp] = useState<ServicoCpuOperacao>('dividir')

  // Produção diária editável — inicializada do servico no mount (re-mount
  // automático via `key={servico.id}` no parent garante reset ao trocar).
  const [producaoRaw, setProducaoRaw] = useState<string>(
    servico.producao_diaria_qtde != null
      ? String(servico.producao_diaria_qtde).replace('.', ',')
      : ''
  )
  const [producaoUnidade, setProducaoUnidade] = useState<string>(
    servico.producao_diaria_unidade ?? ''
  )

  const cpusJaVinculadas = useMemo(() => new Set(links.map((l) => l.cpu_id)), [links])
  const cpusDisponiveis = useMemo(
    () => cpus.filter((c) => !cpusJaVinculadas.has(c.id)),
    [cpus, cpusJaVinculadas]
  )

  const custoAgregado = useMemo(() => {
    let total = 0
    for (const l of links) {
      const fator = Number(l.fator) || 1
      const custo = Number(l.cpu?.custo_unit_calc ?? 0)
      total += aplicarOp(custo, fator, l.operacao ?? 'dividir')
    }
    return total
  }, [links])

  const handleAdicionar = async (): Promise<void> => {
    if (!servico || !novoCpuId) {
      toast.error('Selecione uma CPU')
      return
    }
    const fator = Number(parseBR(novoFator).toString())
    if (!isFinite(fator) || fator === 0) {
      toast.error('Fator deve ser um número diferente de zero')
      return
    }
    try {
      await upsertLink.mutateAsync({
        servico_id: servico.id,
        cpu_id: novoCpuId,
        fator,
        operacao: novoOp,
        ordem: links.length
      })
      setNovoCpuId('')
      setNovoFator('1')
      setNovoOp('dividir')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao vincular CPU')
    }
  }

  const handleAlterarFator = async (linkId: string, raw: string): Promise<void> => {
    const fator = Number(parseBR(raw).toString())
    if (!isFinite(fator) || fator === 0) {
      toast.error('Fator deve ser um número diferente de zero')
      return
    }
    const link = links.find((l) => l.id === linkId)
    if (!link) return
    try {
      await upsertLink.mutateAsync({
        id: linkId,
        servico_id: link.servico_id,
        cpu_id: link.cpu_id,
        fator,
        operacao: link.operacao ?? 'dividir',
        ordem: link.ordem
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    }
  }

  const handleAlterarOperacao = async (
    linkId: string,
    novaOp: ServicoCpuOperacao
  ): Promise<void> => {
    const link = links.find((l) => l.id === linkId)
    if (!link) return
    try {
      await upsertLink.mutateAsync({
        id: linkId,
        servico_id: link.servico_id,
        cpu_id: link.cpu_id,
        fator: link.fator,
        operacao: novaOp,
        ordem: link.ordem
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao alterar operação')
    }
  }

  const handleMover = async (linkId: string, direction: 'up' | 'down'): Promise<void> => {
    const idx = links.findIndex((l) => l.id === linkId)
    if (idx === -1) return
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= links.length) return
    const a = links[idx]
    const b = links[swap]
    try {
      await Promise.all([
        upsertLink.mutateAsync({
          id: a.id,
          servico_id: a.servico_id,
          cpu_id: a.cpu_id,
          fator: a.fator,
          operacao: a.operacao ?? 'dividir',
          ordem: b.ordem
        }),
        upsertLink.mutateAsync({
          id: b.id,
          servico_id: b.servico_id,
          cpu_id: b.cpu_id,
          fator: b.fator,
          operacao: b.operacao ?? 'dividir',
          ordem: a.ordem
        })
      ])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao reordenar')
    }
  }

  const handleExcluir = async (linkId: string, cpuNome: string): Promise<void> => {
    if (!servico) return
    const ok = await confirm({
      title: 'Remover vínculo?',
      description: `O vínculo com "${cpuNome}" será removido. A CPU em si não é afetada.`,
      confirmLabel: 'Remover',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await deleteLink.mutateAsync({ id: linkId, servico_id: servico.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao remover')
    }
  }

  const handleSalvarProducao = async (): Promise<void> => {
    if (!servico) return
    const qtde = producaoRaw.trim() === '' ? null : Number(parseBR(producaoRaw).toString())
    if (qtde !== null && (!isFinite(qtde) || qtde <= 0)) {
      toast.error('Produção diária deve ser maior que zero')
      return
    }
    try {
      await updateProducao.mutateAsync({
        id: servico.id,
        producao_diaria_qtde: qtde,
        producao_diaria_unidade: producaoUnidade.trim() || null
      })
      toast.success('Produção atualizada.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao atualizar')
    }
  }

  const producaoHerdada =
    servico.producao_diaria_qtde == null && links.length > 0 ? links[0].cpu : null

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <span className="text-text-dim font-mono mr-2">{servico.codigo}</span>
          {servico.nome}
          {servico.unidade ? (
            <span className="text-text-dim font-normal ml-2">({servico.unidade})</span>
          ) : null}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          {/* Resumo de custo */}
          <div className="flex items-center justify-between rounded border border-border bg-bg-elevated px-3 py-2">
            <div className="text-2xs font-mono text-text-dim uppercase">
              Custo unitário agregado
            </div>
            <div className="text-base font-mono text-text font-semibold tabular-nums">
              {fmtBRL4(custoAgregado)}
              {servico.unidade ? (
                <span className="text-text-dim text-xs ml-1">/ {servico.unidade}</span>
              ) : null}
            </div>
          </div>

          {/* Produção diária */}
          <div>
            <div className="text-2xs font-mono text-text-dim uppercase mb-1">Produção diária</div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={producaoRaw}
                  onChange={(e) => setProducaoRaw(e.target.value)}
                  placeholder={
                    producaoHerdada
                      ? `Herda: ${formatNumber(Number(producaoHerdada.producao_diaria_qtde))}`
                      : 'Vazio = herda da 1ª CPU vinculada'
                  }
                  className="w-full h-8 px-2 bg-bg border border-border rounded text-xs text-text placeholder:text-text-dim font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <div className="w-24">
                <input
                  type="text"
                  value={producaoUnidade}
                  onChange={(e) => setProducaoUnidade(e.target.value)}
                  placeholder={producaoHerdada ? producaoHerdada.producao_diaria_unidade : 'DIA'}
                  className="w-full h-8 px-2 bg-bg border border-border rounded text-xs text-text placeholder:text-text-dim font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleSalvarProducao()}
                disabled={updateProducao.isPending}
              >
                Salvar
              </Button>
            </div>
            <p className="text-2xs text-text-faint font-mono mt-1">
              Deixe vazio pra herdar da 1ª CPU vinculada.
            </p>
          </div>

          {/* Lista de vínculos */}
          <div>
            <div className="text-2xs font-mono text-text-dim uppercase mb-1">
              CPUs vinculadas ({links.length})
            </div>
            {links.length === 0 ? (
              <div className="text-xs text-text-faint italic px-2 py-3 border border-dashed border-border rounded">
                Nenhuma CPU vinculada. Esse servico ainda usa o modelo legado (CPU vigente única).
                Adicione abaixo pra converter em agregador.
              </div>
            ) : (
              <div className="rounded border border-border overflow-hidden">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-bg-elevated text-text-dim text-2xs uppercase">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">CPU</th>
                      <th className="text-right px-2 py-1.5 font-medium">Custo CPU</th>
                      <th className="text-right px-2 py-1.5 font-medium">Produção/dia</th>
                      <th className="text-center px-2 py-1.5 font-medium w-12">Op</th>
                      <th className="text-right px-2 py-1.5 font-medium">Fator</th>
                      <th className="text-right px-2 py-1.5 font-medium">
                        Custo / {servico.unidade ?? 'un'}
                      </th>
                      <th className="w-24"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {links.map((link, idx) => {
                      const fator = Number(link.fator) || 1
                      const op = link.operacao ?? 'dividir'
                      const contrib = aplicarOp(Number(link.cpu?.custo_unit_calc ?? 0), fator, op)
                      return (
                        <tr key={link.id}>
                          <td className="px-2 py-1.5">
                            <div className="text-text">{link.cpu ? nomeDaCpu(link.cpu) : '—'}</div>
                            <div className="text-text-dim text-2xs">
                              {link.cpu?.servico?.unidade ? (
                                <span>un. CPU: {link.cpu.servico.unidade}</span>
                              ) : (
                                <span className="italic">CPU sem servico-dono</span>
                              )}
                              {link.cpu?.is_vigente === false ? (
                                <span className="text-warn ml-1">
                                  · v{link.cpu.versao} (não vigente)
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-text-muted tabular-nums">
                            {fmtBRL4(Number(link.cpu?.custo_unit_calc ?? 0))}
                          </td>
                          <td className="px-2 py-1.5 text-right text-text-muted tabular-nums">
                            {link.cpu
                              ? `${formatNumber(Number(link.cpu.producao_diaria_qtde))} ${link.cpu.producao_diaria_unidade}`
                              : '—'}
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                void handleAlterarOperacao(
                                  link.id,
                                  op === 'dividir' ? 'multiplicar' : 'dividir'
                                )
                              }
                              className={cn(
                                'w-7 h-6 inline-flex items-center justify-center rounded border text-xs font-bold tabular-nums',
                                op === 'multiplicar'
                                  ? 'border-warn-line bg-warn-glow text-warn'
                                  : 'border-accent-line bg-accent-glow text-accent'
                              )}
                              title={
                                op === 'multiplicar'
                                  ? 'Multiplicar (clique pra trocar pra dividir)'
                                  : 'Dividir (clique pra trocar pra multiplicar)'
                              }
                            >
                              {op === 'multiplicar' ? '×' : '÷'}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <FatorInput
                              valor={link.fator}
                              onSave={(raw) => void handleAlterarFator(link.id, raw)}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-text tabular-nums">
                            {fmtBRL4(contrib)}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-0.5 justify-end">
                              <button
                                type="button"
                                onClick={() => void handleMover(link.id, 'up')}
                                disabled={idx === 0}
                                className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Subir"
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleMover(link.id, 'down')}
                                disabled={idx === links.length - 1}
                                className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Descer"
                              >
                                <ArrowDown size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleExcluir(link.id, link.cpu?.servico?.nome ?? 'CPU')
                                }
                                className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-danger/10"
                                title="Remover vínculo"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Adicionar nova CPU */}
          <div className="border-t border-border pt-3">
            <div className="text-2xs font-mono text-text-dim uppercase mb-1">Vincular nova CPU</div>
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <Select value={novoCpuId} onChange={(e) => setNovoCpuId(e.target.value)}>
                  <option value="">— escolha uma CPU —</option>
                  {cpusDisponiveis.map((c) => {
                    const nome = nomeDaCpu(c)
                    const un = c.servico?.unidade ? ` (${c.servico.unidade})` : ''
                    const labelProd = `${formatNumber(Number(c.producao_diaria_qtde))} ${c.producao_diaria_unidade}`
                    return (
                      <option key={c.id} value={c.id}>
                        {nome}
                        {un} · {fmtBRL4(Number(c.custo_unit_calc))} · {labelProd}
                        {c.is_vigente ? '' : ` · v${c.versao}`}
                      </option>
                    )
                  })}
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-2xs font-mono text-text-dim block mb-0.5">Operação</label>
                <Select
                  value={novoOp}
                  onChange={(e) => setNovoOp(e.target.value as ServicoCpuOperacao)}
                >
                  <option value="dividir">÷ dividir</option>
                  <option value="multiplicar">× multiplicar</option>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-2xs font-mono text-text-dim block mb-0.5">Fator</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={novoFator}
                  onChange={(e) => setNovoFator(e.target.value)}
                  className="w-full h-8 px-2 bg-bg border border-border rounded text-xs text-text font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void handleAdicionar()}
                  disabled={upsertLink.isPending || !novoCpuId}
                  className="w-full"
                >
                  <Plus size={11} /> Vincular
                </Button>
              </div>
            </div>
            <p className="text-2xs text-text-faint font-mono mt-1">
              <strong>÷ dividir</strong>: <code>custo_servico = cpu.custo_unit ÷ fator</code>{' '}
              (conversão de unidade — ex: CPU em m³ → servico em ton, densidade 2,4 → fator 2,4).
              <br />
              <strong>× multiplicar</strong>: <code>custo_servico = cpu.custo_unit × fator</code>{' '}
              (consumo {'>'} 1 unidade-CPU — ex: 5 km de transporte por unidade → fator 5).
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  )
}

// Input de fator com commit on blur / Enter.
function FatorInput({
  valor,
  onSave
}: {
  valor: number
  onSave: (raw: string) => void
}): ReactNode {
  const [raw, setRaw] = useState(String(valor).replace('.', ','))
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const numero = Number(parseBR(raw).toString())
        if (isFinite(numero) && numero !== valor) onSave(raw)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-20 h-7 px-2 bg-bg border border-border rounded text-xs text-text font-mono text-right tabular-nums focus:outline-none focus:border-accent"
    />
  )
}
