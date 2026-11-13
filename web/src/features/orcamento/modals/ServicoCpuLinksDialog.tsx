// Painel de vinculação de CPUs a um servico-agregador.
//
// Cada vínculo: CPU + fator (divisor da unidade) + ordem + observação.
// Custo unitário do serviço = Σ (cpu.custo_unit_calc / fator).
// A produção diária pode ser editada (herda da 1ª CPU vinculada se NULL).

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
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
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { nomeDaCpu } from '../lib/nomeDaCpu'
import type { Servico, ServicoCpuOperacao } from '@/types/orcamento'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

/** Aplica operação ao custo da CPU usando o fator. */
function aplicarOp(custo: number, fator: number, op: ServicoCpuOperacao): number {
  if (!isFinite(fator) || fator === 0) return 0
  return op === 'multiplicar' ? custo * fator : custo / fator
}

const ROTULO_COLUNA = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const ERRO_FATOR = 'O fator deve ser um número diferente de zero.'
const BOTAO_LINHA =
  'inline-flex h-7 w-7 items-center justify-center rounded text-text-dim hover:bg-bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30'

const mensagem = (err: unknown): string | undefined => detalheDoErro(err) ?? undefined

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
  const [tentouVincular, setTentouVincular] = useState(false)
  const [tentouProducao, setTentouProducao] = useState(false)

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

  const fatorNovo = Number(parseBR(novoFator).toString())
  const errosVincular = {
    cpu: novoCpuId ? undefined : 'Escolha a composição.',
    fator: !isFinite(fatorNovo) || fatorNovo === 0 ? ERRO_FATOR : undefined
  }

  const handleAdicionar = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (errosVincular.cpu || errosVincular.fator) {
      setTentouVincular(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await upsertLink.mutateAsync({
        servico_id: servico.id,
        cpu_id: novoCpuId,
        fator: fatorNovo,
        operacao: novoOp,
        ordem: links.length
      })
      setNovoCpuId('')
      setNovoFator('1')
      setNovoOp('dividir')
      setTentouVincular(false)
    } catch (err) {
      toast.error('Não foi possível vincular a composição.', { description: mensagem(err) })
    }
  }

  const handleAlterarFator = async (linkId: string, raw: string): Promise<void> => {
    const fator = Number(parseBR(raw).toString())
    if (!isFinite(fator) || fator === 0) {
      toast.error(ERRO_FATOR)
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
      toast.error('Não foi possível salvar o fator.', { description: mensagem(err) })
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
      toast.error('Não foi possível trocar a operação.', { description: mensagem(err) })
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
      toast.error('Não foi possível mudar a ordem.', { description: mensagem(err) })
    }
  }

  const handleExcluir = async (linkId: string, cpuNome: string): Promise<void> => {
    if (!servico) return
    const ok = await confirm({
      title: 'Desvincular composição?',
      description: `"${cpuNome}" deixa de entrar no custo deste serviço. A composição em si continua existindo.`,
      confirmLabel: 'Desvincular',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await deleteLink.mutateAsync({ id: linkId, servico_id: servico.id })
    } catch (err) {
      toast.error('Não foi possível desvincular a composição.', { description: mensagem(err) })
    }
  }

  const producaoQtde = producaoRaw.trim() === '' ? null : Number(parseBR(producaoRaw).toString())
  const erroProducao =
    producaoQtde !== null && (!isFinite(producaoQtde) || producaoQtde <= 0)
      ? 'A produção diária deve ser maior que zero.'
      : undefined

  const handleSalvarProducao = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!servico) return
    if (erroProducao) {
      setTentouProducao(true)
      e.currentTarget.querySelector<HTMLElement>('input')?.focus()
      return
    }
    try {
      await updateProducao.mutateAsync({
        id: servico.id,
        producao_diaria_qtde: producaoQtde,
        producao_diaria_unidade: producaoUnidade.trim() || null
      })
      toast.success('Produção diária salva.')
    } catch (err) {
      toast.error('Não foi possível salvar a produção diária.', { description: mensagem(err) })
    }
  }

  const producaoHerdada =
    servico.producao_diaria_qtde == null && links.length > 0 ? links[0].cpu : null
  const salvandoLinha = upsertLink.isPending || deleteLink.isPending

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <span className="mr-2 font-normal text-text-muted">{servico.codigo}</span>
          {servico.nome}
          {servico.unidade ? (
            <span className="ml-2 font-normal text-text-muted">({servico.unidade})</span>
          ) : null}
        </DialogTitle>
        <DialogDescription>
          Composições que formam o custo unitário e a produção diária do serviço.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="max-h-[72vh] overflow-y-auto">
        <div className="space-y-4">
          {/* Resumo de custo */}
          <div className="flex items-center justify-between rounded border border-border bg-bg-elevated px-3 py-2">
            <div className={ROTULO_COLUNA}>Custo unitário do serviço</div>
            <div className="tabular text-md font-semibold text-text">
              {fmtBRL4(custoAgregado)}
              {servico.unidade ? (
                <span className="ml-1 text-sm font-normal text-text-muted">
                  por {servico.unidade}
                </span>
              ) : null}
            </div>
          </div>

          {/* Produção diária */}
          <form onSubmit={handleSalvarProducao} noValidate>
            <h3 className="mb-1 text-md font-semibold text-text">Produção diária</h3>
            <div className="flex items-start gap-2">
              <Campo
                rotulo="Quantidade por dia"
                className="flex-1"
                erro={tentouProducao ? erroProducao : undefined}
                dica={
                  producaoHerdada
                    ? `Em branco, usa a da primeira composição vinculada: ${formatNumber(Number(producaoHerdada.producao_diaria_qtde))} ${producaoHerdada.producao_diaria_unidade}.`
                    : 'Em branco, usa a da primeira composição vinculada.'
                }
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={producaoRaw}
                  onChange={(e) => setProducaoRaw(e.target.value)}
                  className="tabular text-right"
                />
              </Campo>
              <Campo rotulo="Unidade" className="w-28">
                <Input
                  autoComplete="off"
                  value={producaoUnidade}
                  onChange={(e) => setProducaoUnidade(e.target.value)}
                  placeholder={
                    producaoHerdada ? producaoHerdada.producao_diaria_unidade : 'Ex.: m³'
                  }
                />
              </Campo>
              <Button
                type="submit"
                variant="secondary"
                className="mt-6"
                disabled={updateProducao.isPending}
              >
                {updateProducao.isPending ? 'Salvando…' : 'Salvar produção'}
              </Button>
            </div>
          </form>

          {/* Lista de vínculos */}
          <div>
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className="text-md font-semibold text-text">Composições vinculadas</h3>
              <span className="text-sm text-text-muted">
                {contar(links.length, 'composição', 'composições')}
              </span>
              {salvandoLinha ? (
                <span role="status" className="ml-auto text-sm text-text-muted">
                  Salvando…
                </span>
              ) : null}
            </div>
            {links.length === 0 ? (
              <p className="rounded border border-dashed border-border px-3 py-3 text-sm text-text-muted">
                Nenhuma composição vinculada. O serviço usa só a composição vigente dele. Vincule
                uma composição abaixo para o custo passar a ser a soma das vinculadas.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className={cn('bg-bg-elevated', ROTULO_COLUNA)}>
                    <tr>
                      <th className="px-2 py-1.5 text-left">Composição</th>
                      <th className="px-2 py-1.5 text-right">Custo da composição</th>
                      <th className="px-2 py-1.5 text-right">Produção por dia</th>
                      <th className="w-20 px-2 py-1.5 text-center">Operação</th>
                      <th className="px-2 py-1.5 text-right">Fator</th>
                      <th className="px-2 py-1.5 text-right">
                        Custo por {servico.unidade ?? 'unidade'}
                      </th>
                      <th className="w-24 px-2 py-1.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {links.map((link, idx) => {
                      const fator = Number(link.fator) || 1
                      const op = link.operacao ?? 'dividir'
                      const contrib = aplicarOp(Number(link.cpu?.custo_unit_calc ?? 0), fator, op)
                      const nome = link.cpu ? nomeDaCpu(link.cpu) : 'composição'
                      return (
                        <tr key={link.id}>
                          <td className="px-2 py-1.5">
                            <div className="text-text">{link.cpu ? nomeDaCpu(link.cpu) : '—'}</div>
                            <div className="text-xs text-text-muted">
                              {link.cpu?.servico?.unidade ? (
                                <span>Unidade: {link.cpu.servico.unidade}</span>
                              ) : (
                                <span>Composição sem serviço</span>
                              )}
                              {link.cpu?.is_vigente === false ? (
                                <span className="ml-1 font-medium text-text">
                                  · versão {link.cpu.versao}, não vigente
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="tabular px-2 py-1.5 text-right text-text-muted">
                            {fmtBRL4(Number(link.cpu?.custo_unit_calc ?? 0))}
                          </td>
                          <td className="tabular px-2 py-1.5 text-right text-text-muted">
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
                                'inline-flex h-7 w-8 items-center justify-center rounded border text-sm font-bold text-text',
                                op === 'multiplicar'
                                  ? 'border-warn/40 bg-warn/10'
                                  : 'border-accent-line bg-accent-glow'
                              )}
                              title={
                                op === 'multiplicar'
                                  ? 'Multiplica pelo fator. Clique para dividir.'
                                  : 'Divide pelo fator. Clique para multiplicar.'
                              }
                              aria-label={
                                op === 'multiplicar'
                                  ? `${nome}: multiplica pelo fator. Trocar para dividir.`
                                  : `${nome}: divide pelo fator. Trocar para multiplicar.`
                              }
                            >
                              <span aria-hidden>{op === 'multiplicar' ? '×' : '÷'}</span>
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <FatorInput
                              valor={link.fator}
                              rotulo={`Fator de ${nome}`}
                              onSave={(raw) => void handleAlterarFator(link.id, raw)}
                            />
                          </td>
                          <td className="tabular px-2 py-1.5 text-right text-text">
                            {fmtBRL4(contrib)}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                onClick={() => void handleMover(link.id, 'up')}
                                disabled={idx === 0}
                                className={BOTAO_LINHA}
                                title="Subir"
                                aria-label={`Subir ${nome}`}
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleMover(link.id, 'down')}
                                disabled={idx === links.length - 1}
                                className={BOTAO_LINHA}
                                title="Descer"
                                aria-label={`Descer ${nome}`}
                              >
                                <ArrowDown size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleExcluir(
                                    link.id,
                                    link.cpu?.servico?.nome ?? 'Esta composição'
                                  )
                                }
                                className={cn(BOTAO_LINHA, 'hover:bg-danger/10 hover:text-danger')}
                                title="Desvincular"
                                aria-label={`Desvincular ${nome}`}
                              >
                                <Trash2 size={12} />
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
          <form onSubmit={handleAdicionar} noValidate className="border-t border-border pt-3">
            <h3 className="mb-1 text-md font-semibold text-text">Vincular outra composição</h3>
            <div className="grid grid-cols-12 items-start gap-2">
              <Campo
                rotulo="Composição"
                obrigatorio
                className="col-span-12 sm:col-span-6"
                erro={tentouVincular ? errosVincular.cpu : undefined}
              >
                <Select value={novoCpuId} onChange={(e) => setNovoCpuId(e.target.value)}>
                  <option value="">
                    {cpusDisponiveis.length === 0 ? 'Nenhuma composição disponível' : 'Selecione…'}
                  </option>
                  {cpusDisponiveis.map((c) => {
                    const nome = nomeDaCpu(c)
                    const un = c.servico?.unidade ? ` (${c.servico.unidade})` : ''
                    const labelProd = `${formatNumber(Number(c.producao_diaria_qtde))} ${c.producao_diaria_unidade}`
                    return (
                      <option key={c.id} value={c.id}>
                        {nome}
                        {un} · {fmtBRL4(Number(c.custo_unit_calc))} · {labelProd}
                        {c.is_vigente ? '' : ` · versão ${c.versao}`}
                      </option>
                    )
                  })}
                </Select>
              </Campo>
              <Campo rotulo="Operação" className="col-span-5 sm:col-span-2">
                <Select
                  value={novoOp}
                  onChange={(e) => setNovoOp(e.target.value as ServicoCpuOperacao)}
                >
                  <option value="dividir">÷ Dividir</option>
                  <option value="multiplicar">× Multiplicar</option>
                </Select>
              </Campo>
              <Campo
                rotulo="Fator"
                obrigatorio
                className="col-span-3 sm:col-span-2"
                erro={tentouVincular ? errosVincular.fator : undefined}
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={novoFator}
                  onChange={(e) => setNovoFator(e.target.value)}
                  className="tabular text-right"
                />
              </Campo>
              <div className="col-span-4 mt-6 sm:col-span-2">
                <Button type="submit" disabled={upsertLink.isPending} className="w-full">
                  <Plus size={12} /> {upsertLink.isPending ? 'Vinculando…' : 'Vincular'}
                </Button>
              </div>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-text-muted">
              <li>
                <strong className="text-text">Dividir:</strong> o custo da composição é dividido
                pelo fator. Serve para converter unidade (ex.: composição em m³ e serviço em t, com
                densidade 2,4, usa fator 2,4).
              </li>
              <li>
                <strong className="text-text">Multiplicar:</strong> o custo da composição é
                multiplicado pelo fator. Serve quando o serviço consome mais de uma unidade da
                composição (ex.: 5 km de transporte por unidade, usa fator 5).
              </li>
            </ul>
          </form>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  )
}

// Input de fator com commit on blur / Enter.
function FatorInput({
  valor,
  rotulo,
  onSave
}: {
  valor: number
  rotulo: string
  onSave: (raw: string) => void
}): ReactNode {
  const [raw, setRaw] = useState(String(valor).replace('.', ','))
  const numero = Number(parseBR(raw).toString())
  const invalido = !isFinite(numero) || numero === 0
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      value={raw}
      aria-label={rotulo}
      aria-invalid={invalido ? true : undefined}
      title={invalido ? ERRO_FATOR : undefined}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        if (isFinite(numero) && numero !== valor) onSave(raw)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="tabular ml-auto h-7 w-20 text-right"
    />
  )
}
