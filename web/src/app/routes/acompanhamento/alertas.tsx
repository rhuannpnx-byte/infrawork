import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { contar, rotuloAlertaStatusPlural } from '@/lib/rotulos'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { FiltroChips } from '@/components/ui/filtro-chips'
import { ErroConsulta, Vazio } from '@/components/ui/estado'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { motivoDoErro } from '@/features/acompanhamento/lib/mensagem-erro'
import { useAlertas, useRecalcularAlertas } from '@/features/acompanhamento/hooks/alertas'
import { AlertaCard } from '@/features/acompanhamento/components/alertas/AlertaCard'
import type { AlertaSeveridade, AlertaStatus } from '@/types/acompanhamento'

export function AcompanhamentoAlertasPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Alertas">
      <RequireObra pageTitle="Alertas">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const [statusFiltro, setStatusFiltro] = useState<AlertaStatus[]>(['aberto'])
  const [severidadeFiltro, setSeveridadeFiltro] = useState<AlertaSeveridade[]>([])
  const {
    data: alertas = [],
    isLoading,
    error,
    refetch
  } = useAlertas(obraId, {
    status: statusFiltro,
    severidade: severidadeFiltro.length ? severidadeFiltro : undefined
  })
  const recalc = useRecalcularAlertas()

  const grupos = useMemo(() => {
    const ordem: AlertaSeveridade[] = ['critical', 'warn', 'info']
    const out: Record<AlertaSeveridade, typeof alertas> = { critical: [], warn: [], info: [] }
    for (const a of alertas) out[a.severidade].push(a)
    return ordem.map((s) => ({ severidade: s, itens: out[s] }))
  }, [alertas])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Alertas"
        subtitle={
          isLoading
            ? 'Carregando os alertas…'
            : error
              ? undefined
              : `${contar(alertas.length, 'alerta', 'alertas')} (${statusFiltro.map(rotuloAlertaStatusPlural).join(', ')})`
        }
        actions={
          <Button
            size="sm"
            variant="default"
            disabled={recalc.isPending}
            onClick={async () => {
              try {
                const r = await recalc.mutateAsync({ obra_id: obraId })
                const item = r.resultados[0]
                if (item?.erros.length)
                  toast.error(`Não foi possível recalcular os alertas. ${item.erros.join('; ')}`)
                else if (item)
                  toast.success(
                    `${contar(item.abertos, 'alerta aberto', 'alertas abertos')}: ${contar(item.inseridos, 'novo', 'novos')} e ${contar(item.resolvidos, 'resolvido', 'resolvidos')} automaticamente.`
                  )
              } catch (e) {
                toast.error(`Não foi possível recalcular os alertas.${motivoDoErro(e)}`)
              }
            }}
          >
            <RefreshCw size={13} className={recalc.isPending ? 'animate-spin' : ''} />
            {recalc.isPending ? 'Recalculando…' : 'Recalcular'}
          </Button>
        }
      />

      <div className="border-b border-border px-5 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2 bg-bg-panel">
        <FiltroChips
          rotulo="Situação"
          opcoes={[
            { valor: 'aberto', rotulo: 'Abertos' },
            { valor: 'silenciado', rotulo: 'Silenciados' },
            { valor: 'resolvido', rotulo: 'Resolvidos' }
          ]}
          valores={statusFiltro}
          // sem nenhuma situação marcada a lista volta para os abertos
          aoMudar={(v) => setStatusFiltro(v.length ? v : ['aberto'])}
        />
        <FiltroChips
          rotulo="Gravidade"
          opcoes={[
            { valor: 'critical', rotulo: 'Críticos' },
            { valor: 'warn', rotulo: 'Avisos' },
            { valor: 'info', rotulo: 'Informativos' }
          ]}
          valores={severidadeFiltro}
          aoMudar={setSeveridadeFiltro}
        />
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <PulseBlock key={i} h={80} />)}
        {error ? (
          <ErroConsulta erro={error} oQue="os alertas" aoTentar={() => void refetch()} />
        ) : null}
        {!isLoading && !error && alertas.length === 0 && (
          <Vazio className="px-1">
            {statusFiltro.length === 1 && statusFiltro[0] === 'aberto' && !severidadeFiltro.length
              ? 'Nenhum alerta aberto. Use Recalcular para conferir a obra de novo.'
              : 'Nenhum alerta neste filtro.'}
          </Vazio>
        )}
        {grupos.map((g) =>
          g.itens.length === 0 ? null : (
            <div key={g.severidade} className="space-y-2">
              <h2 className="text-lg font-semibold text-text">
                {g.severidade === 'critical'
                  ? 'Críticos'
                  : g.severidade === 'warn'
                    ? 'Avisos'
                    : 'Informativos'}{' '}
                <span className="font-normal text-text-muted tabular">{g.itens.length}</span>
              </h2>
              <div className="space-y-2">
                {g.itens.map((a) => (
                  <AlertaCard key={a.id} alerta={a} />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
