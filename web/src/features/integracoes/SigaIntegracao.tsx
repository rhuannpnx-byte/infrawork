import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Download, Link2, Stethoscope, Unlink } from 'lucide-react'
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
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import {
  useIntegracao,
  useSiga,
  useUltimaExecucao,
  type DiagnosticoSiga,
  type Integracao
} from './hooks'

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

/** O que o diagnóstico achou, em uma frase. */
function resumoDiagnostico(d: DiagnosticoSiga): string {
  const pnj = d.tabelas.filter((t) => t.tabela.startsWith('pnj_')).length
  const cdt = d.tabelas.length - pnj
  const lidas = d.uso.pnj_controle_producao?.linhas_lidas ?? 0
  return `${contar(pnj, 'tabela de produção', 'tabelas de produção')} e ${contar(cdt, 'de cadastro', 'de cadastro')}, ${contar(d.colunas.length, 'coluna lida', 'colunas lidas')}, ${contar(lidas, 'lançamento recente analisado', 'lançamentos recentes analisados')}.`
}

function baixarJson(nome: string, conteudo: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(conteudo, null, 2)], { type: 'application/json' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

/** Conexão da empresa com o SIGA: conectar, alterar, desconectar e (god) ler a estrutura das tabelas. */
export function SigaIntegracao({
  empresaId,
  podeGerenciar,
  podeDiagnosticar
}: {
  empresaId: string
  podeGerenciar: boolean
  podeDiagnosticar: boolean
}): ReactNode {
  const { data: cfg, isLoading, error, refetch } = useIntegracao(empresaId, 'siga')
  const { data: ultimo } = useUltimaExecucao(cfg?.id, 'diagnostico')
  const siga = useSiga()
  const confirm = useConfirm()
  const [conectar, setConectar] = useState(false)
  if (isLoading) return null
  if (error)
    return (
      <ErroConsulta
        erro={error}
        oQue="a integração com o SIGA"
        aoTentar={() => void refetch()}
        compacto
      />
    )

  const acao = siga.isPending ? siga.variables?.acao : null
  const diagnosticar = (): void =>
    siga.mutate(
      { acao: 'diagnostico', empresa_id: empresaId },
      {
        onSuccess: (r) =>
          void toast.success(
            `Estrutura do SIGA lida.${r.resumo ? ` ${resumoDiagnostico(r.resumo)}` : ''}`
          ),
        onError: (e) => void toast.error(`Não foi possível ler a estrutura do SIGA. ${e.message}`)
      }
    )
  const desconectar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Desconectar o SIGA?',
      description:
        'A credencial é apagada do servidor. A produção que já foi trazida continua no InfraWork, mas deixa de ser atualizada.',
      confirmLabel: 'Desconectar',
      variant: 'danger'
    })
    if (!ok) return
    siga.mutate(
      { acao: 'desconectar', empresa_id: empresaId },
      {
        onSuccess: () => void toast.success('SIGA desconectado.'),
        onError: (e) => void toast.error(`Não foi possível desconectar o SIGA. ${e.message}`)
      }
    )
  }

  return (
    <section
      aria-labelledby="siga-titulo"
      className="rounded border border-border bg-bg-panel px-4 py-3"
      data-testid="siga-integracao"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="siga-titulo" className="text-lg font-semibold text-text">
              SIGA
            </h2>
            <Badge variant={cfg ? 'success' : 'outline'}>
              {cfg ? 'Conectado' : 'Não conectado'}
            </Badge>
          </div>
          <p className="mt-0.5 max-w-[75ch] text-sm text-text-muted">
            {cfg
              ? `Banco ${cfg.config.banco ?? '—'} em ${cfg.config.host ?? '—'}, usuário ${cfg.config.usuario ?? '—'}, conectado em ${dataHora(cfg.conectado_em)}.`
              : podeGerenciar
                ? 'Conecte o banco de dados do SIGA para a produção e as fotos da empresa virem de lá.'
                : 'O SIGA é conectado pelo administrador da empresa.'}
          </p>
          {cfg && ultimo ? (
            <p
              className={cn(
                'mt-0.5 max-w-[75ch] text-sm',
                ultimo.ok === false ? 'text-danger' : 'text-text-muted'
              )}
              data-testid="siga-diagnostico"
            >
              Estrutura lida em {dataHora(ultimo.iniciado_em)}
              {ultimo.ok === null
                ? ', ainda em andamento.'
                : ultimo.ok && ultimo.resumo
                  ? `: ${resumoDiagnostico(ultimo.resumo)}`
                  : ` falhou: ${ultimo.erro ?? 'sem mensagem do servidor'}`}
            </p>
          ) : null}
        </div>
        {podeGerenciar ? (
          cfg ? (
            <div className="flex flex-wrap items-center gap-2">
              {podeDiagnosticar ? (
                <Button size="sm" disabled={siga.isPending} onClick={diagnosticar}>
                  <Stethoscope size={12} />
                  {acao === 'diagnostico' ? 'Lendo…' : 'Ler a estrutura'}
                </Button>
              ) : null}
              {podeDiagnosticar && ultimo?.ok && ultimo.resumo ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => baixarJson('siga-estrutura.json', ultimo.resumo)}
                >
                  <Download size={12} /> Baixar
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={siga.isPending}
                onClick={() => setConectar(true)}
              >
                Alterar credenciais
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={siga.isPending}
                onClick={() => void desconectar()}
              >
                <Unlink size={12} /> {acao === 'desconectar' ? 'Desconectando…' : 'Desconectar'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConectar(true)}>
              <Link2 size={12} /> Conectar SIGA
            </Button>
          )
        ) : null}
      </div>
      {conectar ? (
        <ConectarDialog
          empresaId={empresaId}
          atual={cfg ?? null}
          onClose={() => setConectar(false)}
        />
      ) : null}
    </section>
  )
}

function ConectarDialog({
  empresaId,
  atual,
  onClose
}: {
  empresaId: string
  atual: Integracao | null
  onClose: () => void
}): ReactNode {
  const siga = useSiga()
  const [host, setHost] = useState(atual?.config.host ?? '')
  const [porta, setPorta] = useState(atual?.config.porta ? String(atual.config.porta) : '3306')
  const [banco, setBanco] = useState(atual?.config.banco ?? '')
  const [usuario, setUsuario] = useState(atual?.config.usuario ?? '')
  const [senha, setSenha] = useState('')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const nPorta = Number(porta)
  const erros = {
    host: !host.trim()
      ? 'Informe o servidor do SIGA.'
      : /^[a-z0-9.-]+$/i.test(host.trim())
        ? null
        : 'Só o nome ou o endereço IP, sem "http://" nem barras.',
    porta:
      Number.isInteger(nPorta) && nPorta >= 1 && nPorta <= 65535
        ? null
        : 'Informe um número entre 1 e 65535.',
    banco: banco.trim() ? null : 'Informe o nome do banco de dados.',
    usuario: usuario.trim() ? null : 'Informe o usuário.',
    senha: senha ? null : 'Informe a senha.'
  }

  const enviar = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setTentou(true)
    const primeiro = (Object.keys(erros) as Array<keyof typeof erros>).find((k) => erros[k])
    if (primeiro) {
      e.currentTarget.querySelector<HTMLElement>(`#siga-${primeiro}`)?.focus()
      return
    }
    setErro(null)
    siga.mutate(
      {
        acao: 'conectar',
        empresa_id: empresaId,
        host: host.trim(),
        porta: nPorta,
        banco: banco.trim(),
        usuario: usuario.trim(),
        senha
      },
      {
        onSuccess: () => {
          toast.success('SIGA conectado.')
          onClose()
        },
        onError: (err) => setErro(err.message)
      }
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="md" disableDismiss={siga.isPending}>
      <form onSubmit={enviar} noValidate>
        <DialogHeader>
          <DialogTitle>{atual ? 'Alterar credenciais do SIGA' : 'Conectar SIGA'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[calc(100dvh-9.5rem)] space-y-3 overflow-y-auto">
          <DialogErrorBanner message={erro} />
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Campo
              rotulo="Servidor"
              obrigatorio
              erro={tentou ? erros.host : null}
              dica="Nome ou endereço IP do banco de dados do SIGA."
            >
              <Input
                id="siga-host"
                autoComplete="off"
                spellCheck={false}
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Porta" obrigatorio erro={tentou ? erros.porta : null}>
              <Input
                id="siga-porta"
                mascara="inteiro"
                value={porta}
                onChange={(e) => setPorta(e.target.value)}
              />
            </Campo>
          </div>
          <Campo rotulo="Banco de dados" obrigatorio erro={tentou ? erros.banco : null}>
            <Input
              id="siga-banco"
              autoComplete="off"
              spellCheck={false}
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Usuário" obrigatorio erro={tentou ? erros.usuario : null}>
              <Input
                id="siga-usuario"
                autoComplete="off"
                spellCheck={false}
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Senha" obrigatorio erro={tentou ? erros.senha : null}>
              <Input
                id="siga-senha"
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>
          </div>
          <p className="text-sm text-text-muted">
            A conexão é testada antes de salvar. A senha fica cifrada no servidor e não é exibida de
            novo. O servidor do SIGA precisa aceitar conexões de fora da rede da empresa.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={siga.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={siga.isPending}>
            {siga.isPending ? 'Testando…' : 'Testar e conectar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
