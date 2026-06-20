import { type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Smartphone, Power, PlugZap, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useSessao, useConectarSessao, useDesconectarSessao } from '@/features/whatsapp/hooks'
import type { WhatsAppSessaoStatus } from '@/types/whatsapp'

const STATUS_LABEL: Record<
  WhatsAppSessaoStatus,
  { label: string; variant: 'success' | 'warn' | 'danger' | 'outline' }
> = {
  conectado: { label: 'Conectado', variant: 'success' },
  aguardando_qr: { label: 'Aguardando QR', variant: 'warn' },
  erro: { label: 'Erro', variant: 'danger' },
  desconectado: { label: 'Desconectado', variant: 'outline' }
}

export function WhatsAppSessaoPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="WhatsApp — Sessão">
      <SessaoInner />
    </RequireRole>
  )
}

function SessaoInner(): ReactNode {
  const scope = useCurrentScope()
  const { data: sessao, isLoading } = useSessao()
  const conectar = useConectarSessao()
  const desconectar = useDesconectarSessao()

  const status = sessao?.status ?? 'desconectado'
  const meta = STATUS_LABEL[status]

  const onConectar = async (): Promise<void> => {
    try {
      await conectar.mutateAsync({ empresaId: scope.empresaId })
      toast.success('Conexão solicitada. O QR aparecerá em instantes.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conectar')
    }
  }

  const onDesconectar = async (): Promise<void> => {
    if (!sessao) return
    try {
      await desconectar.mutateAsync({ id: sessao.id })
      toast.success('Sessão desconectada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desconectar')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp — Sessão"
        subtitle="Conecte um número dedicado para o agente monitorar grupos de obra."
        actions={
          status === 'desconectado' ? (
            <Button size="sm" variant="default" onClick={onConectar} disabled={conectar.isPending}>
              <PlugZap size={12} /> Conectar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDesconectar}
              disabled={desconectar.isPending}
            >
              <Power size={12} /> Desconectar
            </Button>
          )
        }
      />

      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-text-dim text-xs font-mono">
            <Loader2 size={14} className="animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="w-full space-y-4">
            <div className="w-full rounded border border-border bg-bg-panel px-4 py-3 flex items-center gap-3">
              <Smartphone size={18} className="text-accent shrink-0" />
              <div className="flex-1">
                <div className="text-xs text-text font-medium">
                  {sessao?.nome ?? 'Nenhuma sessão criada'}
                </div>
                <div className="text-2xs text-text-muted font-mono">
                  {sessao?.phone ? `+${sessao.phone}` : 'sem número pareado'}
                  {sessao?.last_seen
                    ? ` · visto ${new Date(sessao.last_seen).toLocaleString('pt-BR')}`
                    : ''}
                </div>
              </div>
              <Badge variant={meta.variant}>{meta.label}</Badge>
            </div>

            {status === 'erro' && sessao?.ultimo_erro ? (
              <div className="w-full rounded border border-danger/40 bg-danger/10 px-4 py-3 text-xs font-mono text-danger whitespace-pre-wrap">
                {sessao.ultimo_erro}
              </div>
            ) : null}

            {status === 'aguardando_qr' ? (
              sessao?.qr_code ? (
                <div className="rounded border border-border bg-white p-5 inline-flex flex-col items-center gap-3">
                  <QRCodeSVG value={sessao.qr_code} size={240} />
                  <p className="text-2xs text-neutral-600 font-mono max-w-[240px] text-center">
                    WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie este código.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-text-dim text-xs font-mono">
                  <Loader2 size={14} className="animate-spin" /> Gerando QR code… (o agente precisa
                  estar rodando)
                </div>
              )
            ) : null}

            {status === 'conectado' ? (
              <EmptyState
                icon="check-circle-2"
                title="Sessão ativa"
                description="O agente está monitorando os grupos marcados. Configure os grupos na aba Grupos."
              />
            ) : null}

            {status === 'desconectado' ? (
              <p className="text-xs text-text-muted">
                Clique em <strong>Conectar</strong> para iniciar o pareamento. Use um número
                dedicado — o agente precisa estar em execução para gerar o QR.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
