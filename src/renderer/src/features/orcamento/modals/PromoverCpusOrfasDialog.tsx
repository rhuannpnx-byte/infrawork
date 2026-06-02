// Dialog: promove CPUs órfãs (sem servico-dono) em serviços-folha.
//
// Cada CPU vira um servico com 1 vínculo (servico_cpu_link, fator=1.0).
// Nome sugerido: extraído das `notas` da CPU (texto "nome original: ..."),
// caso contrário fallback `"CPU #{id-prefix}"`.

import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCpusOrfas, usePromoverCpusEmServicos } from '../hooks/servico-links'
import { useServicos } from '../hooks/servicos'
import { fmtBRL4 } from '@/lib/money'
import { formatNumber } from '@/lib/format/number'
import { cn } from '@/lib/utils'
import { nomeDaCpu } from '../lib/nomeDaCpu'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

interface DraftRow {
  cpuId: string
  selecionado: boolean
  codigo: string
  nome: string
  unidade: string
  custo: number
  producao: number
  producaoUnidade: string
}

export function PromoverCpusOrfasDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const { data: orfas = [], isLoading } = useCpusOrfas(open ? obraId : null)
  const { data: servicos = [] } = useServicos(open ? obraId : null)
  const promover = usePromoverCpusEmServicos()

  // Códigos IMP-NNN já usados na obra → próximo disponível.
  const nextImpStart = useMemo(() => {
    const nums = servicos
      .map((s) => s.codigo)
      .filter((c) => /^IMP-\d+$/.test(c))
      .map((c) => parseInt(c.replace('IMP-', ''), 10))
    return nums.length > 0 ? Math.max(...nums) + 1 : 1
  }, [servicos])

  const [draft, setDraft] = useState<DraftRow[] | null>(null)

  // Inicializa draft uma vez quando abre + dados carregam.
  // (Usa key derivada pra evitar setState-in-effect.)
  const dataKey = `${open ? '1' : '0'}-${orfas.length}-${nextImpStart}`
  const [lastKey, setLastKey] = useState('')
  if (lastKey !== dataKey && open && orfas.length > 0) {
    setLastKey(dataKey)
    setDraft(
      orfas.map((cpu, i) => ({
        cpuId: cpu.id,
        selecionado: true,
        codigo: `IMP-${String(nextImpStart + i).padStart(3, '0')}`,
        nome: nomeDaCpu(cpu),
        unidade: cpu.producao_diaria_unidade,
        custo: Number(cpu.custo_unit_calc),
        producao: Number(cpu.producao_diaria_qtde),
        producaoUnidade: cpu.producao_diaria_unidade
      }))
    )
  }

  const linhas = draft ?? []
  const selecionadas = linhas.filter((l) => l.selecionado)

  const updateRow = (idx: number, patch: Partial<DraftRow>): void => {
    setDraft((prev) => (prev ? prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)) : null))
  }
  const toggleAll = (): void => {
    setDraft((prev) =>
      prev ? prev.map((r) => ({ ...r, selecionado: !linhas.every((l) => l.selecionado) })) : null
    )
  }

  const handlePromover = async (): Promise<void> => {
    if (selecionadas.length === 0) return
    try {
      const r = await promover.mutateAsync({
        obra_id: obraId,
        cpus: selecionadas.map((l) => ({
          id: l.cpuId,
          nome: l.nome.trim() || 'Servico',
          unidade: l.unidade.trim() || 'un',
          codigo: l.codigo.trim()
        }))
      })
      toast.success(`${r.criados} servico(s) criado(s).`)
      setDraft(null)
      setLastKey('')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao promover')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <DialogHeader>
        <DialogTitle>Promover CPUs em serviços</DialogTitle>
      </DialogHeader>
      <DialogBody>
        {isLoading ? (
          <div className="text-xs text-text-muted font-mono">Carregando…</div>
        ) : orfas.length === 0 ? (
          <div className="text-xs text-text-muted font-mono italic">
            Nenhuma CPU órfã (todas já estão vinculadas a algum serviço).
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-2xs text-text-dim font-mono">
              CPUs sem servico-dono podem ser convertidas em servicos-folha. Cada CPU vira 1 servico
              com vínculo <code>fator = 1</code>. Você pode ajustar fator/agregar mais CPUs depois
              pela página Serviços.
            </p>
            <div className="rounded border border-border overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-bg-elevated text-text-dim text-2xs uppercase">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={toggleAll}
                        className={cn(
                          'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs',
                          linhas.every((l) => l.selecionado)
                            ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                            : linhas.some((l) => l.selecionado)
                              ? 'border-accent bg-accent/40 text-[color:var(--primary-foreground)]'
                              : 'border-border-strong hover:border-accent text-text-faint'
                        )}
                      >
                        {linhas.every((l) => l.selecionado)
                          ? '✓'
                          : linhas.some((l) => l.selecionado)
                            ? '−'
                            : ''}
                      </button>
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Código</th>
                    <th className="px-2 py-1.5 text-left font-medium">Nome do servico</th>
                    <th className="px-2 py-1.5 text-left font-medium">Unidade</th>
                    <th className="px-2 py-1.5 text-right font-medium">Custo/CPU</th>
                    <th className="px-2 py-1.5 text-right font-medium">Produção</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhas.map((row, idx) => (
                    <tr key={row.cpuId}>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => updateRow(idx, { selecionado: !row.selecionado })}
                          className={cn(
                            'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs',
                            row.selecionado
                              ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                              : 'border-border text-text-faint hover:border-accent'
                          )}
                        >
                          {row.selecionado ? '✓' : ''}
                        </button>
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={row.codigo}
                          onChange={(e) => updateRow(idx, { codigo: e.target.value })}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={row.nome}
                          onChange={(e) => updateRow(idx, { nome: e.target.value })}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={row.unidade}
                          onChange={(e) => updateRow(idx, { unidade: e.target.value })}
                          className="h-7 text-xs w-16"
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-muted">
                        {fmtBRL4(row.custo)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-muted">
                        {formatNumber(row.producao)} {row.producaoUnidade}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={promover.isPending}>
          Cancelar
        </Button>
        <Button
          variant="default"
          onClick={() => void handlePromover()}
          disabled={selecionadas.length === 0 || promover.isPending}
        >
          {promover.isPending
            ? 'Promovendo…'
            : `Promover ${selecionadas.length} CPU(s) em servicos`}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
