import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
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
import { useAgruparComoServico } from '../hooks/plan-orc'
import { useServicos } from '../hooks/servicos'
import { useCpus } from '../hooks/cpus'
import { useIndireto } from '../hooks/indireto'
import { fmtBRL, fmtQtd } from '@/lib/money'
import type { ItemTreeNode, QtdRefModo } from '@/types/orcamento'

type VinculoModo = 'cpu' | 'indireto'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Receitas pré-selecionadas que serão penduradas sob o novo grupo. */
  receitas: ItemTreeNode[]
}

export function AgruparComoServicoDialog({
  open,
  onOpenChange,
  obraId,
  receitas
}: Props): ReactNode {
  const { data: servicos = [] } = useServicos(obraId)
  const { data: cpusVigentes = [] } = useCpus(obraId)
  const { data: indiretos = [] } = useIndireto(obraId)
  const agrupar = useAgruparComoServico()

  const [vinculo, setVinculo] = useState<VinculoModo>('cpu')
  const [descricao, setDescricao] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [indiretoId, setIndiretoId] = useState('')
  const [modo, setModo] = useState<QtdRefModo>('manual')
  const [qtdManual, setQtdManual] = useState('')
  const [filhosRef, setFilhosRef] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setVinculo('cpu')
    setDescricao('')
    setServicoId('')
    setIndiretoId('')
    setModo('manual')
    setQtdManual('')
    setFilhosRef(new Set())
    setError(null)
  }

  const servicosFolha = useMemo(() => servicos.filter((s) => s.unidade !== null), [servicos])

  const servicoSelecionado = servicos.find((s) => s.id === servicoId)
  const cpuVigente = cpusVigentes.find((c) => c.servico_id === servicoId)

  // Calcula a quantidade efetiva conforme modo escolhido
  const qtdCalculada = useMemo(() => {
    if (modo === 'manual') {
      return Number(qtdManual.replace(',', '.')) || 0
    }
    if (modo === 'heranca') {
      const primeiro = receitas.find((r) => filhosRef.has(r.id))
      return primeiro?.quantidade ?? 0
    }
    // soma_filhos
    return receitas
      .filter((r) => filhosRef.has(r.id))
      .reduce((acc, r) => acc + (r.quantidade ?? 0), 0)
  }, [modo, qtdManual, filhosRef, receitas])

  const toggleFilho = (id: string): void => {
    setFilhosRef((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const indiretoSelecionado = indiretos.find((i) => i.id === indiretoId)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)

    if (!descricao.trim()) {
      setError('Informe uma descrição para o grupo.')
      return
    }
    if (receitas.length === 0) {
      setError('Nenhuma receita selecionada.')
      return
    }
    if (modo !== 'manual' && filhosRef.size === 0) {
      setError('Selecione pelo menos uma receita para derivar a quantidade.')
      return
    }
    if (qtdCalculada <= 0) {
      setError('Quantidade de referência deve ser > 0.')
      return
    }

    let unidadeRef: string | null = null
    if (vinculo === 'cpu') {
      if (!servicoId) {
        setError('Selecione um serviço.')
        return
      }
      if (!servicoSelecionado?.unidade) {
        setError('Serviço escolhido não tem unidade definida.')
        return
      }
      unidadeRef = servicoSelecionado.unidade
    } else {
      if (!indiretoId) {
        setError('Selecione um item de indireto.')
        return
      }
      // Indireto não tem unidade definida no schema — usa 'VB' (verba) como padrão.
      unidadeRef = 'VB'
    }

    try {
      await agrupar.mutateAsync({
        obra_id: obraId,
        descricao: descricao.trim(),
        servico_id: vinculo === 'cpu' ? servicoId : null,
        cpu_snapshot_id: null, // hook gera snapshot automaticamente quando há serviço
        indireto_id: vinculo === 'indireto' ? indiretoId : null,
        unidade_referencia: unidadeRef!,
        qtd_ref_modo: modo,
        quantidade_referencia: qtdCalculada,
        qtd_ref_filhos: modo === 'manual' ? [] : Array.from(filhosRef),
        receitas_ids: receitas.map((r) => r.id)
      })
      toast.success(`Grupo "${descricao}" criado com ${receitas.length} receita(s).`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao agrupar')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={agrupar.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Agrupar como serviço</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="text-2xs font-mono text-text-dim">
            {receitas.length} receita(s) serão pendurada(s) sob o novo grupo.{' '}
            {vinculo === 'cpu'
              ? 'O custo virá da CPU vigente do serviço × quantidade de referência.'
              : 'O custo virá do item de indireto selecionado × quantidade de referência.'}{' '}
            A venda do grupo será a soma das receitas filhas.
          </div>

          <div>
            <Label htmlFor="g-desc" className="block">
              Descrição do grupo
            </Label>
            <Input
              id="g-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              autoFocus
              required
              placeholder="Ex.: CBUQ Capa, Drenagem, Sinalização Horizontal"
            />
          </div>

          {/* Toggle: vincular a CPU ou a Indireto */}
          <div>
            <Label className="block">Vincular custo a</Label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setVinculo('cpu')}
                className={
                  vinculo === 'cpu'
                    ? 'px-3 py-1 text-2xs rounded bg-accent text-[color:var(--primary-foreground)] border border-accent-line'
                    : 'px-3 py-1 text-2xs rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
                }
              >
                Serviço (CPU)
              </button>
              <button
                type="button"
                onClick={() => setVinculo('indireto')}
                disabled={indiretos.length === 0}
                className={
                  vinculo === 'indireto'
                    ? 'px-3 py-1 text-2xs rounded bg-accent text-[color:var(--primary-foreground)] border border-accent-line'
                    : 'px-3 py-1 text-2xs rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed'
                }
                title={
                  indiretos.length === 0
                    ? 'Nenhum item de indireto cadastrado nessa obra.'
                    : undefined
                }
              >
                Indireto
              </button>
            </div>
          </div>

          {vinculo === 'cpu' ? (
            <div>
              <Label htmlFor="g-serv" className="block">
                Serviço (com CPU)
              </Label>
              <Select
                id="g-serv"
                value={servicoId}
                onChange={(e) => setServicoId(e.target.value)}
              >
                <option value="">— selecione —</option>
                {servicosFolha.map((s) => {
                  const cpu = cpusVigentes.find((c) => c.servico_id === s.id)
                  return (
                    <option key={s.id} value={s.id}>
                      {s.codigo} · {s.nome} ({s.unidade})
                      {cpu
                        ? ` · CPU v${cpu.versao} ${fmtBRL(cpu.custo_unit_calc)}/un`
                        : ' · sem CPU'}
                    </option>
                  )
                })}
              </Select>
              {servicoSelecionado && !cpuVigente ? (
                <p className="text-2xs text-warn font-mono mt-1">
                  Aviso: serviço selecionado não tem CPU vigente. Grupo será criado mas custo = 0
                  até você criar a CPU.
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              <Label htmlFor="g-ind" className="block">
                Item de indireto
              </Label>
              <Select
                id="g-ind"
                value={indiretoId}
                onChange={(e) => setIndiretoId(e.target.value)}
              >
                <option value="">— selecione —</option>
                {indiretos.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo} · {i.descricao} · {fmtBRL(i.valor_total)}
                  </option>
                ))}
              </Select>
              {indiretoSelecionado ? (
                <p className="text-2xs text-text-muted font-mono mt-1">
                  Custo do agrupador = {fmtBRL(indiretoSelecionado.valor_total)} × qtd. de
                  referência.
                </p>
              ) : null}
            </div>
          )}

          <div>
            <Label className="block">Quantidade de referência (multiplica a CPU)</Label>
            <div className="flex gap-2 mb-2">
              {(['manual', 'heranca', 'soma_filhos'] as QtdRefModo[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={
                    modo === m
                      ? 'px-3 py-1 text-2xs rounded bg-accent text-[color:var(--primary-foreground)] border border-accent-line'
                      : 'px-3 py-1 text-2xs rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
                  }
                >
                  {m === 'manual'
                    ? 'Manual'
                    : m === 'heranca'
                      ? 'Herança de filho'
                      : 'Soma de filhos'}
                </button>
              ))}
            </div>

            {modo === 'manual' ? (
              <Input
                value={qtdManual}
                onChange={(e) => setQtdManual(e.target.value)}
                inputMode="decimal"
                placeholder={`Quantidade em ${servicoSelecionado?.unidade ?? '—'}`}
              />
            ) : (
              <div className="rounded border border-border bg-bg-elevated">
                <div className="px-3 py-1.5 text-2xs font-mono text-text-dim border-b border-border">
                  {modo === 'heranca'
                    ? 'Marque UMA receita — sua quantidade vai virar a qtd. de referência.'
                    : 'Marque as receitas — suas quantidades serão somadas.'}
                </div>
                <div className="max-h-48 overflow-auto">
                  {receitas.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs"
                    >
                      <input
                        type={modo === 'heranca' ? 'radio' : 'checkbox'}
                        name="filhos-ref"
                        checked={filhosRef.has(r.id)}
                        onChange={() => {
                          if (modo === 'heranca') {
                            setFilhosRef(new Set([r.id]))
                          } else {
                            toggleFilho(r.id)
                          }
                        }}
                      />
                      <span className="text-text-muted font-mono w-20 truncate">{r.codigo}</span>
                      <span className="text-text flex-1 truncate">{r.descricao}</span>
                      <span className="text-2xs font-mono text-text-dim">
                        {fmtQtd(r.quantidade ?? 0)} {r.unidade}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <p className="text-2xs font-mono text-text-muted mt-1">
              Quantidade calculada: <span className="text-text">{fmtQtd(qtdCalculada)}</span>{' '}
              {servicoSelecionado?.unidade ?? ''}
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={agrupar.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={agrupar.isPending}>
            {agrupar.isPending ? 'Agrupando…' : 'Criar grupo'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
