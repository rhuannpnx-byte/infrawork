import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { Badge } from '@/components/ui/badge'
import { useSessao, useGrupos, useLog } from '@/features/whatsapp/hooks'
import { getSignedUrls } from '@/features/acompanhamento/hooks/fotos'
import type { WhatsAppDecisao } from '@/types/whatsapp'

const DECISAO_META: Record<
  WhatsAppDecisao,
  { label: string; variant: 'success' | 'warn' | 'outline' | 'danger' }
> = {
  subida: { label: 'Subida', variant: 'success' },
  sem_geo: { label: 'Sem geo', variant: 'warn' },
  nao_servico: { label: 'Não serviço', variant: 'outline' },
  duplicada: { label: 'Duplicada', variant: 'outline' },
  erro: { label: 'Erro', variant: 'danger' }
}

export function WhatsAppLogPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="WhatsApp — Log de fotos">
      <LogInner />
    </RequireRole>
  )
}

function LogThumb({ fotoId }: { fotoId: string }): ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void getSignedUrls([fotoId], 'thumb').then((m) => {
      if (vivo) setUrl(m[fotoId] ?? null)
    })
    return () => {
      vivo = false
    }
  }, [fotoId])
  if (!url) return <div className="h-10 w-10 rounded bg-bg-elevated" />
  return <img src={url} alt="" className="h-10 w-10 rounded object-cover" />
}

function LogInner(): ReactNode {
  const { data: sessao } = useSessao()
  const { data: grupos } = useGrupos(sessao?.id)
  const grupoIds = useMemo(() => (grupos ?? []).map((g) => g.id), [grupos])
  const { data: log, isLoading } = useLog(grupoIds)

  const nomeGrupo = (id: string): string =>
    (grupos ?? []).find((g) => g.id === id)?.nome ?? id.slice(0, 8)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp — Log de fotos"
        subtitle="Mensagens processadas pelo agente e a decisão de ingestão de cada uma."
      />
      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="text-text-dim text-xs font-mono">Carregando…</div>
        ) : (log ?? []).length === 0 ? (
          <EmptyState
            icon="list-checks"
            title="Sem registros"
            description="Quando o agente processar fotos dos grupos monitorados, elas aparecerão aqui."
          />
        ) : (
          <div className="rounded border border-border bg-bg-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg sticky top-0">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 w-16">Foto</th>
                  <th className="text-left px-3 py-2">Grupo</th>
                  <th className="text-left px-3 py-2 w-40">Remetente</th>
                  <th className="text-center px-3 py-2 w-28">Decisão</th>
                  <th className="text-right px-3 py-2 w-40">Quando</th>
                </tr>
              </thead>
              <tbody>
                {(log ?? []).map((l) => {
                  const meta = DECISAO_META[l.decisao]
                  return (
                    <tr key={l.id} className="border-b border-border/40 hover:bg-bg-hover">
                      <td className="px-3 py-2">
                        {l.foto_id ? (
                          <LogThumb fotoId={l.foto_id} />
                        ) : (
                          <div className="h-10 w-10 rounded bg-bg-elevated flex items-center justify-center">
                            <ImageOff size={14} className="text-text-dim" />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text truncate max-w-[220px]">
                        {nomeGrupo(l.grupo_id)}
                      </td>
                      <td className="px-3 py-2 font-mono text-text-dim truncate max-w-[160px]">
                        {l.remetente?.split('@')[0] ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-dim">
                        {new Date(l.processado_em).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
