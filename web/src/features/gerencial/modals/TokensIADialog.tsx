import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Bot, Copy, KeyRound, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import {
  MCP_URL,
  useCriarTokenIA,
  useRevogarTokenIA,
  useStatusMcp,
  validade,
  type Estado
} from '../hooks/mcp'

const dataBR = (s: string | null): string => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')

function copiar(t: string): void {
  void navigator.clipboard
    .writeText(t)
    .then(() => toast.success('Copiado.'))
    .catch(() => toast.error('Não foi possível copiar. Selecione o texto e copie.'))
}

const COR: Record<Estado, string> = { ok: 'bg-success', off: 'bg-danger', verificando: 'bg-warn' }

export function PontoEstado({ estado }: { estado: Estado }): ReactNode {
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        COR[estado],
        estado === 'verificando' && 'animate-pulse'
      )}
    />
  )
}

type Cliente = 'claude_ai' | 'chatgpt' | 'claude_code' | 'cursor' | 'outros'

const CLIENTES: { id: Cliente; nome: string; oauth: boolean }[] = [
  { id: 'claude_ai', nome: 'Claude.ai / Desktop', oauth: true },
  { id: 'chatgpt', nome: 'ChatGPT', oauth: true },
  { id: 'claude_code', nome: 'Claude Code', oauth: false },
  { id: 'cursor', nome: 'Cursor / IDEs', oauth: false },
  { id: 'outros', nome: 'n8n / agentes', oauth: false }
]

function Trecho({
  texto,
  oQue,
  testId
}: {
  texto: string
  oQue: string
  testId?: string
}): ReactNode {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-bg p-2">
      <pre
        className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-text"
        data-testid={testId}
      >
        {texto}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={`Copiar ${oQue}`}
        title={`Copiar ${oQue}`}
        onClick={() => copiar(texto)}
      >
        <Copy size={12} />
      </Button>
    </div>
  )
}

function Instrucoes({
  cliente,
  token,
  oauth
}: {
  cliente: Cliente
  token: string | null
  oauth: Estado
}): ReactNode {
  const tk = token ?? 'iwk_SEU_TOKEN'
  const semToken = !token ? (
    <p className="text-text-muted">Gere um token abaixo: ele entra sozinho no texto para copiar.</p>
  ) : null
  const avisoOauth =
    oauth === 'off' ? (
      <p className="font-medium text-text">
        O login por conta não respondeu agora. Confira se o servidor está no ar (botão Verificar).
        Enquanto isso, use um cliente com token (Claude Code, Cursor, n8n).
      </p>
    ) : null
  switch (cliente) {
    case 'claude_ai':
      return (
        <div className="space-y-2">
          {avisoOauth}
          <ol className="list-decimal space-y-1 pl-5 text-text-muted">
            <li>
              Claude.ai ou Claude Desktop › Configurações › Conectores › Adicionar conector
              personalizado.
            </li>
            <li>Nome: InfraWork. URL do servidor:</li>
          </ol>
          <Trecho texto={MCP_URL} oQue="o endereço do servidor" />
          <p className="text-text-muted">
            Ao conectar, entre com a sua conta do InfraWork e clique em <strong>Permitir</strong>.
          </p>
        </div>
      )
    case 'chatgpt':
      return (
        <div className="space-y-2">
          {avisoOauth}
          <ol className="list-decimal space-y-1 pl-5 text-text-muted">
            <li>
              ChatGPT › Configurações › Aplicativos e conectores › modo desenvolvedor › Criar.
            </li>
            <li>URL do servidor MCP (autenticação OAuth):</li>
          </ol>
          <Trecho texto={MCP_URL} oQue="o endereço do servidor" />
          <p className="text-text-muted">Entre com a sua conta do InfraWork e permita o acesso.</p>
        </div>
      )
    case 'claude_code':
      return (
        <div className="space-y-2">
          <p className="text-text-muted">No terminal:</p>
          <Trecho
            testId="instr-claude-code"
            oQue="o comando"
            texto={`claude mcp add --transport http infrawork ${MCP_URL} --header "Authorization: Bearer ${tk}"`}
          />
          {semToken}
        </div>
      )
    case 'cursor':
      return (
        <div className="space-y-2">
          <p className="text-text-muted">
            Em <code>.cursor/mcp.json</code> (ou no arquivo de servidores MCP da sua IDE):
          </p>
          <Trecho
            oQue="a configuração"
            texto={JSON.stringify(
              {
                mcpServers: {
                  infrawork: { url: MCP_URL, headers: { Authorization: `Bearer ${tk}` } }
                }
              },
              null,
              2
            )}
          />
          {semToken}
        </div>
      )
    case 'outros':
      return (
        <div className="space-y-2">
          <p className="text-text-muted">
            Qualquer cliente MCP por HTTP (Streamable HTTP): use o endereço e o cabeçalho abaixo.
          </p>
          <Trecho texto={MCP_URL} oQue="o endereço do servidor" />
          <Trecho texto={`Authorization: Bearer ${tk}`} oQue="o cabeçalho" />
          {semToken}
        </div>
      )
  }
}

/** Status do MCP, instruções de conexão por cliente e tokens pessoais. */
export function TokensIADialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): ReactNode {
  const { status, recarregar } = useStatusMcp()
  const criar = useCriarTokenIA()
  const revogar = useRevogarTokenIA()
  const [cliente, setCliente] = useState<Cliente>('claude_code')
  const [nome, setNome] = useState('')
  const [dias, setDias] = useState('90')
  const [novo, setNovo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const confirmar = useConfirm()

  const erroNome = nome.trim() ? undefined : 'Dê um nome ao token, para reconhecer depois.'

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setErro(null)
    if (erroNome) {
      setTentou(true)
      e.currentTarget.querySelector<HTMLElement>('input')?.focus()
      return
    }
    setNovo(null)
    criar.mutate(
      { nome: nome.trim(), dias: dias === 'sem' ? null : Number(dias) },
      {
        onSuccess: (t) => {
          setNovo(t)
          setNome('')
          setTentou(false)
        },
        onError: (e) => setErro(`Não foi possível gerar o token. ${e.message}`)
      }
    )
  }

  const cards: { icone: ReactNode; titulo: string; estado: Estado; texto: ReactNode }[] = [
    {
      icone: <Server size={12} />,
      titulo: 'Servidor',
      estado: status.servidor,
      texto:
        status.servidor === 'ok'
          ? 'No ar'
          : status.servidor === 'off'
            ? 'Fora do ar'
            : 'Verificando…'
    },
    {
      icone: <ShieldCheck size={12} />,
      titulo: 'Login por conta',
      estado: status.oauth,
      texto:
        status.oauth === 'ok'
          ? 'Disponível (Claude.ai, ChatGPT)'
          : status.oauth === 'off'
            ? 'Sem resposta'
            : 'Verificando…'
    },
    {
      icone: <KeyRound size={12} />,
      titulo: 'Seus tokens',
      estado: status.ativos.length > 0 ? 'ok' : 'off',
      texto: `${contar(status.ativos.length, 'ativo', 'ativos')}, último uso em ${dataBR(status.ultimoUso)}`
    }
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <DialogHeader>
        <DialogTitle>
          <span className="inline-flex items-center gap-1.5">
            <Bot size={16} aria-hidden /> Conectar IA ao InfraWork
          </span>
        </DialogTitle>
        <DialogDescription>
          A IA age com as suas permissões no InfraWork. Ações que apagam ou mexem em muita coisa
          pedem confirmação.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="max-h-[75vh] space-y-4 overflow-y-auto text-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="mcp-status">
          {cards.map((c) => (
            <div key={c.titulo} className="rounded border border-border bg-bg-elevated p-2.5">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                {c.icone} {c.titulo}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-text">
                <PontoEstado estado={c.estado} /> {c.texto}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-muted">Endereço:</span>
          <button
            type="button"
            className="break-all text-left text-accent hover:underline"
            title="Copiar o endereço do servidor"
            onClick={() => copiar(MCP_URL)}
          >
            {MCP_URL}
          </button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={recarregar}
          >
            <RefreshCw size={12} /> Verificar
          </Button>
        </div>

        <div className="space-y-2">
          <h3 className="text-md font-semibold text-text">Como conectar</h3>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Aplicativo de IA">
            {CLIENTES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={cliente === c.id}
                onClick={() => setCliente(c.id)}
                className={cn(
                  'h-7 rounded border px-2.5 text-xs',
                  cliente === c.id
                    ? 'border-accent bg-accent/15 font-medium text-text'
                    : 'border-border-strong text-text-muted hover:bg-bg-hover hover:text-text'
                )}
              >
                {c.nome}
                <span className="ml-1 font-normal text-text-muted">
                  {c.oauth ? '(login)' : '(token)'}
                </span>
              </button>
            ))}
          </div>
          <div className="rounded border border-border bg-bg-elevated p-3">
            <Instrucoes cliente={cliente} token={novo} oauth={status.oauth} />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-md font-semibold text-text">Tokens pessoais</h3>
          <form onSubmit={onSubmit} noValidate className="flex items-start gap-2">
            <Campo
              rotulo="Nome do novo token"
              obrigatorio
              erro={tentou ? erroNome : undefined}
              className="flex-1"
            >
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Claude Code no notebook"
                maxLength={80}
                autoComplete="off"
              />
            </Campo>
            <Campo rotulo="Validade" className="w-36">
              <Select value={dias} onChange={(e) => setDias(e.target.value)}>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">1 ano</option>
                <option value="sem">Sem validade</option>
              </Select>
            </Campo>
            <Button type="submit" className="mt-6" disabled={criar.isPending}>
              {criar.isPending ? 'Gerando…' : 'Gerar token'}
            </Button>
          </form>
          <DialogErrorBanner message={erro} />
          {novo ? (
            <div className="space-y-1.5 rounded border border-warn/40 bg-warn/10 p-3">
              <div className="font-semibold text-text">
                Copie agora: o token não aparece de novo. Ele já está nas instruções acima.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all font-mono text-text" data-testid="token-novo">
                  {novo}
                </code>
                <Button type="button" size="sm" variant="secondary" onClick={() => copiar(novo)}>
                  <Copy size={12} /> Copiar
                </Button>
              </div>
            </div>
          ) : null}
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                <th className="py-1.5 pr-2">Nome</th>
                <th className="py-1.5 pr-2">Começa com</th>
                <th className="py-1.5 pr-2">Criado em</th>
                <th className="py-1.5 pr-2">Expira em</th>
                <th className="py-1.5 pr-2">Último uso</th>
                <th className="py-1.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {status.ativos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-text-muted">
                    Nenhum token ativo. Gere um token acima para conectar um aplicativo que não usa
                    o login por conta.
                  </td>
                </tr>
              ) : (
                status.ativos.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 text-text">
                      {t.nome}
                      {t.tipo === 'oauth' ? (
                        <span className="ml-1.5 rounded bg-accent/15 px-1 text-xs text-text">
                          login
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 font-mono text-text-muted">{t.prefixo}…</td>
                    <td className="tabular py-1.5 text-text-muted">{dataBR(t.criado_em)}</td>
                    <td className="tabular py-1.5 text-text-muted">{dataBR(validade(t))}</td>
                    <td className="tabular py-1.5 text-text-muted">{dataBR(t.ultimo_uso_em)}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={revogar.isPending}
                        aria-label={`Revogar o token ${t.nome}`}
                        onClick={async () => {
                          const ok = await confirmar({
                            title: 'Revogar token?',
                            description: `O que estiver conectado com o token "${t.nome}" perde o acesso na hora. Não dá para desfazer.`,
                            confirmLabel: 'Revogar',
                            variant: 'danger'
                          })
                          if (!ok) return
                          revogar.mutate(t.id, {
                            onSuccess: () => toast.success('Token revogado.'),
                            onError: (e) =>
                              toast.error('Não foi possível revogar o token.', {
                                description: e.message
                              })
                          })
                        }}
                      >
                        Revogar
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
