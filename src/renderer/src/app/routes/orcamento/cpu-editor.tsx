import { useState, type ReactNode, type FormEvent } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCpu, usePublishCpu, useUpdateCpu } from '@/features/orcamento/hooks/cpus'
import { useRecursos } from '@/features/orcamento/hooks/recursos'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CpuItemsTable } from '@/features/orcamento/components/CpuItemsTable'
import { fmtBRL, fmtBRL4 } from '@/lib/money'
import type { CpuItemGrupo } from '@/types/orcamento'

const BLOCOS: CpuItemGrupo[] = ['EQUIPAMENTO', 'COMBUSTIVEL', 'MO', 'MATERIAL']

export function CpuEditorPage(): ReactNode {
  const { id } = useParams({ from: '/orcamento/cpus/$id' })
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const { data: cpu, isLoading, error } = useCpu(id)
  const { data: recursos = [] } = useRecursos(cpu?.obra_id)
  void scope
  const updateCpu = useUpdateCpu()
  const publish = usePublishCpu()

  const [producaoLocal, setProducaoLocal] = useState<string>('')
  const [notasLocal, setNotasLocal] = useState<string>('')
  const [headerDirty, setHeaderDirty] = useState(false)

  // Inicializa estado local quando cpu chega.
  if (cpu && producaoLocal === '' && !headerDirty) {
    setProducaoLocal(String(cpu.producao_diaria_qtde))
    setNotasLocal(cpu.notas ?? '')
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="CPU" />
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted font-mono">
          Carregando…
        </div>
      </div>
    )
  }
  if (error || !cpu) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="CPU" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="alert-triangle"
            title="CPU não encontrada"
            description={error?.message ?? 'Verifique o link.'}
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate({ to: '/orcamento/cpus' })}
              >
                Voltar
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const itensPorGrupo: Record<CpuItemGrupo, typeof cpu.itens> = {
    EQUIPAMENTO: [],
    COMBUSTIVEL: [],
    MO: [],
    MATERIAL: []
  }
  for (const it of cpu.itens) itensPorGrupo[it.grupo].push(it)

  const saveHeader = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const prod = Number(producaoLocal.replace(',', '.'))
    if (isNaN(prod) || prod <= 0) {
      toast.error('Produção diária precisa ser > 0.')
      return
    }
    try {
      await updateCpu.mutateAsync({
        id: cpu.id,
        producao_diaria_qtde: prod,
        notas: notasLocal.trim() || null
      })
      toast.success('Cabeçalho salvo.')
      setHeaderDirty(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    }
  }

  const handlePublish = async (): Promise<void> => {
    try {
      await publish.mutateAsync({ id: cpu.id })
      toast.success('CPU marcada como vigente. Versões anteriores foram revogadas.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao publicar')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={cpu.servico ? `${cpu.servico.codigo} — ${cpu.servico.nome}` : 'CPU'}
        subtitle={`Versão v${cpu.versao}${cpu.servico?.unidade ? ` · unidade ${cpu.servico.unidade}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {cpu.is_vigente ? <Badge variant="success">vigente</Badge> : <Badge>histórico</Badge>}
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/orcamento/cpus' })}>
              <ArrowLeft size={11} /> Voltar
            </Button>
            {!cpu.is_vigente ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePublish}
                disabled={publish.isPending}
              >
                <CheckCircle2 size={11} /> {publish.isPending ? 'Publicando…' : 'Tornar vigente'}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Cabeçalho da CPU */}
        <form
          onSubmit={saveHeader}
          className="rounded border border-border bg-bg-panel p-4 space-y-3"
        >
          <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">Cabeçalho</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="prod">Produção diária</Label>
              <Input
                id="prod"
                value={producaoLocal}
                onChange={(e) => {
                  setProducaoLocal(e.target.value)
                  setHeaderDirty(true)
                }}
                inputMode="decimal"
              />
              <div className="text-2xs text-text-dim font-mono mt-1">
                {cpu.producao_diaria_unidade} (base do custo unitário)
              </div>
            </div>
            <div className="col-span-2">
              <Label htmlFor="notas">Notas</Label>
              <Input
                id="notas"
                value={notasLocal}
                onChange={(e) => {
                  setNotasLocal(e.target.value)
                  setHeaderDirty(true)
                }}
                placeholder="Observações da composição"
              />
            </div>
          </div>
          {headerDirty ? (
            <div className="flex justify-end">
              <Button type="submit" variant="default" size="sm" disabled={updateCpu.isPending}>
                <Save size={11} /> {updateCpu.isPending ? 'Salvando…' : 'Salvar cabeçalho'}
              </Button>
            </div>
          ) : null}
        </form>

        {/* Resumo de custos */}
        <div className="grid grid-cols-5 gap-3">
          <CustoCard label="Equipamento" value={cpu.custo_eq_dia_calc} hint="por dia" />
          <CustoCard label="Combustível" value={cpu.custo_comb_dia_calc} hint="por dia" />
          <CustoCard label="Mão de obra" value={cpu.custo_mo_dia_calc} hint="por dia" />
          <CustoCard label="Material" value={cpu.custo_mat_dia_calc} hint="por dia" />
          <CustoCard
            label="Custo unitário"
            value={cpu.custo_unit_calc}
            hint={cpu.servico?.unidade ? `por ${cpu.servico.unidade}` : 'unitário'}
            highlight
            precise
          />
        </div>

        {/* 4 blocos */}
        {BLOCOS.map((g) => (
          <CpuItemsTable
            key={g}
            cpuId={cpu.id}
            grupo={g}
            itens={itensPorGrupo[g]}
            recursos={recursos}
            producaoDiaria={cpu.producao_diaria_qtde}
            producaoUnidade={cpu.servico?.unidade}
          />
        ))}
      </div>
    </div>
  )
}

function CustoCard({
  label,
  value,
  hint,
  highlight,
  precise
}: {
  label: string
  value: number
  hint?: string
  highlight?: boolean
  precise?: boolean
}): ReactNode {
  return (
    <div
      className={
        highlight
          ? 'rounded border border-accent-line bg-accent/5 p-3'
          : 'rounded border border-border bg-bg-panel p-3'
      }
    >
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">{label}</div>
      <div
        className={
          highlight
            ? 'text-lg font-semibold font-mono text-accent tabular-nums'
            : 'text-md font-mono text-text tabular-nums'
        }
      >
        {precise ? fmtBRL4(value) : fmtBRL(value)}
      </div>
      {hint ? <div className="text-2xs text-text-dim font-mono mt-0.5">{hint}</div> : null}
    </div>
  )
}
