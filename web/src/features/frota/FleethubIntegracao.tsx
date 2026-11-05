import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Link2, RefreshCw, Unlink } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import {
  useFleethub,
  useFleethubConfig,
  useUltimaSyncFleet
} from '@/features/acompanhamento/hooks/viagens'
import { cn } from '@/lib/utils'

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Conta da FleetHub da empresa: conectar, alterar, desconectar e sincronizar. */
export function FleethubIntegracao({
  empresaId,
  podeGerenciar
}: {
  empresaId: string
  podeGerenciar: boolean
}): ReactNode {
  const { data: cfg, isLoading } = useFleethubConfig(empresaId)
  const { data: ultima } = useUltimaSyncFleet(empresaId)
  const fleet = useFleethub()
  const confirm = useConfirm()
  const [conectar, setConectar] = useState(false)
  if (isLoading) return null

  const sincronizar = (): void =>
    fleet.mutate(
      { acao: 'sincronizar', empresa_id: empresaId },
      {
        onSuccess: (r) =>
          void toast.success(
            `FleetHub: ${r.novos ?? 0} novo(s), ${r.atualizados ?? 0} atualizado(s), ${r.inativados ?? 0} inativado(s)${r.capacidades != null ? `, ${r.capacidades} com cubagem` : ''}.`
          ),
        onError: (e) => void toast.error(e.message)
      }
    )
  const desconectar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Desconectar a FleetHub?',
      description:
        'A senha é apagada do servidor e a frota deixa de ser atualizada. Os veículos já trazidos continuam cadastrados.',
      confirmLabel: 'Desconectar',
      variant: 'danger'
    })
    if (!ok) return
    fleet.mutate(
      { acao: 'desconectar', empresa_id: empresaId },
      {
        onSuccess: () => void toast.success('FleetHub desconectada.'),
        onError: (e) => void toast.error(e.message)
      }
    )
  }

  return (
    <section
      className="mb-4 rounded border border-border bg-bg-panel px-4 py-3"
      data-testid="fleethub-integracao"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text">
            Integração FleetHub{' '}
            <span
              className={cn('ml-1 text-2xs font-normal', cfg ? 'text-success' : 'text-text-dim')}
            >
              {cfg ? '● conectada' : '○ não conectada'}
            </span>
          </p>
          <p className="mt-0.5 text-2xs text-text-muted">
            {cfg
              ? `Conta ${cfg.email} · desde ${dataHora(cfg.conectado_em)}`
              : 'Se a empresa usa a FleetHub, conecte a conta para trazer caminhões e máquinas automaticamente. Sem ela, cadastre os veículos abaixo.'}
          </p>
          {cfg && ultima ? (
            <p
              className={cn(
                'mt-0.5 text-2xs',
                ultima.ok === false ? 'text-danger' : 'text-text-muted'
              )}
              data-testid="fleet-ultima"
            >
              Última sincronização: {dataHora(ultima.iniciado_em)}
              {ultima.ok === null
                ? ' · em andamento'
                : ultima.ok
                  ? ` · ${ultima.novos} novo(s) · ${ultima.atualizados} atualizado(s) · ${ultima.inativados} inativado(s)${ultima.capacidades != null ? ` · ${ultima.capacidades} com cubagem` : ''}`
                  : ` · falhou: ${ultima.mensagem ?? ''}`}
            </p>
          ) : null}
        </div>
        {podeGerenciar ? (
          cfg ? (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={fleet.isPending} onClick={sincronizar}>
                <RefreshCw size={12} className={cn(fleet.isPending && 'animate-spin')} />
                {fleet.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConectar(true)}>
                Alterar credenciais
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => void desconectar()}
              >
                <Unlink size={12} /> Desconectar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConectar(true)}>
              <Link2 size={12} /> Conectar FleetHub
            </Button>
          )
        ) : null}
      </div>
      {conectar ? (
        <ConectarDialog
          empresaId={empresaId}
          emailAtual={cfg?.email ?? ''}
          onClose={() => setConectar(false)}
        />
      ) : null}
    </section>
  )
}

function ConectarDialog({
  empresaId,
  emailAtual,
  onClose
}: {
  empresaId: string
  emailAtual: string
  onClose: () => void
}): ReactNode {
  const fleet = useFleethub()
  const [email, setEmail] = useState(emailAtual)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const enviar = (e: FormEvent): void => {
    e.preventDefault()
    setErro(null)
    fleet.mutate(
      { acao: 'conectar', empresa_id: empresaId, email, senha },
      {
        onSuccess: () => {
          toast.success('FleetHub conectada. Use "Sincronizar agora" para trazer a frota.')
          onClose()
        },
        onError: (err) => setErro(err.message)
      }
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" disableDismiss={fleet.isPending}>
      <form onSubmit={enviar}>
        <DialogHeader>
          <DialogTitle>Conectar FleetHub</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />
          <div>
            <Label htmlFor="fh-email">E-mail da FleetHub</Label>
            <Input
              id="fh-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="fh-senha">Senha</Label>
            <Input
              id="fh-senha"
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>
          <p className="text-2xs text-text-dim">
            O login é testado antes de salvar. A senha fica cifrada no servidor e não é exibida de
            novo; o InfraWork só lê a lista de equipamentos.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={fleet.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={fleet.isPending || !email.trim() || !senha}>
            {fleet.isPending ? 'Testando…' : 'Testar e conectar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
