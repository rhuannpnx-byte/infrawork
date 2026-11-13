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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { ErroConsulta } from '@/components/ui/estado'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import {
  useFleethub,
  useFleethubConfig,
  useUltimaSyncFleet
} from '@/features/acompanhamento/hooks/viagens'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const resumoSync = (r: {
  novos?: number | null
  atualizados?: number | null
  inativados?: number | null
  capacidades?: number | null
}): string =>
  `${contar(Number(r.novos ?? 0), 'novo', 'novos')}, ${contar(Number(r.atualizados ?? 0), 'atualizado', 'atualizados')}, ${contar(Number(r.inativados ?? 0), 'inativado', 'inativados')}${r.capacidades != null ? `, ${r.capacidades.toLocaleString('pt-BR')} com cubagem` : ''}`

/** Conta da FleetHub da empresa: conectar, alterar, desconectar e sincronizar. */
export function FleethubIntegracao({
  empresaId,
  podeGerenciar
}: {
  empresaId: string
  podeGerenciar: boolean
}): ReactNode {
  const { data: cfg, isLoading, error, refetch } = useFleethubConfig(empresaId)
  const { data: ultima } = useUltimaSyncFleet(empresaId)
  const fleet = useFleethub()
  const confirm = useConfirm()
  const [conectar, setConectar] = useState(false)
  if (isLoading) return null
  if (error)
    return (
      <ErroConsulta
        erro={error}
        oQue="a integração com a FleetHub"
        aoTentar={() => void refetch()}
        compacto
        className="mb-4"
      />
    )

  const acao = fleet.isPending ? fleet.variables?.acao : null
  const sincronizar = (): void =>
    fleet.mutate(
      { acao: 'sincronizar', empresa_id: empresaId },
      {
        onSuccess: (r) =>
          void toast.success(`Frota sincronizada com a FleetHub: ${resumoSync(r)}.`),
        onError: (e) =>
          void toast.error(`Não foi possível sincronizar com a FleetHub. ${e.message}`)
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
        onError: (e) => void toast.error(`Não foi possível desconectar a FleetHub. ${e.message}`)
      }
    )
  }

  return (
    <section
      aria-labelledby="fleethub-titulo"
      className="mb-4 rounded border border-border bg-bg-panel px-4 py-3"
      data-testid="fleethub-integracao"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="fleethub-titulo" className="text-lg font-semibold text-text">
              Integração FleetHub
            </h2>
            <Badge variant={cfg ? 'success' : 'outline'}>
              {cfg ? 'Conectada' : 'Não conectada'}
            </Badge>
          </div>
          <p className="mt-0.5 max-w-[75ch] text-sm text-text-muted">
            {cfg
              ? `Conta ${cfg.email}, conectada em ${dataHora(cfg.conectado_em)}.`
              : podeGerenciar
                ? 'Se a empresa usa a FleetHub, conecte a conta para trazer caminhões e máquinas automaticamente. Sem ela, cadastre os veículos no cadastro manual, no fim da página.'
                : 'A conta da FleetHub é conectada pelo administrador da empresa. Sem ela, cadastre os veículos no cadastro manual, no fim da página.'}
          </p>
          {cfg && ultima ? (
            <p
              className={cn(
                'mt-0.5 text-sm',
                ultima.ok === false ? 'text-danger' : 'text-text-muted'
              )}
              data-testid="fleet-ultima"
            >
              Última sincronização em {dataHora(ultima.iniciado_em)}
              {ultima.ok === null
                ? ', ainda em andamento.'
                : ultima.ok
                  ? `: ${resumoSync(ultima)}.`
                  : ` falhou: ${ultima.mensagem ?? 'sem mensagem do servidor'}`}
            </p>
          ) : null}
        </div>
        {podeGerenciar ? (
          cfg ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={fleet.isPending} onClick={sincronizar}>
                <RefreshCw size={12} className={cn(acao === 'sincronizar' && 'animate-spin')} />
                {acao === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar agora'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={fleet.isPending}
                onClick={() => setConectar(true)}
              >
                Alterar credenciais
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={fleet.isPending}
                onClick={() => void desconectar()}
              >
                <Unlink size={12} /> {acao === 'desconectar' ? 'Desconectando…' : 'Desconectar'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConectar(true)}>
              <Link2 size={12} /> Conectar FleetHub
            </Button>
          )
        ) : cfg ? (
          <p className="text-sm text-text-muted">Quem sincroniza é o administrador da empresa.</p>
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
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const erroEmail = !email.trim()
    ? 'Informe o e-mail da conta da FleetHub.'
    : /^\S+@\S+\.\S+$/.test(email.trim())
      ? null
      : 'Este e-mail não parece válido.'
  const erroSenha = senha ? null : 'Informe a senha da conta da FleetHub.'

  const enviar = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setTentou(true)
    if (erroEmail || erroSenha) {
      e.currentTarget.querySelector<HTMLElement>(erroEmail ? '#fh-email' : '#fh-senha')?.focus()
      return
    }
    setErro(null)
    fleet.mutate(
      { acao: 'conectar', empresa_id: empresaId, email, senha },
      {
        onSuccess: () => {
          toast.success('FleetHub conectada. Use "Sincronizar agora" para trazer a frota.')
          onClose()
        },
        onError: (err) => setErro(`Não foi possível conectar à FleetHub. ${err.message}`)
      }
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" disableDismiss={fleet.isPending}>
      <form onSubmit={enviar} noValidate>
        <DialogHeader>
          <DialogTitle>
            {emailAtual ? 'Alterar credenciais da FleetHub' : 'Conectar FleetHub'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />
          <Campo rotulo="E-mail da FleetHub" obrigatorio erro={tentou ? erroEmail : null}>
            <Input
              id="fh-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Senha" obrigatorio erro={tentou ? erroSenha : null}>
            <Input
              id="fh-senha"
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </Campo>
          <p className="text-sm text-text-muted">
            O login é testado antes de salvar. A senha fica cifrada no servidor e não é exibida de
            novo; o InfraWork só lê a lista de equipamentos.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={fleet.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={fleet.isPending}>
            {fleet.isPending ? 'Testando…' : 'Testar e conectar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
