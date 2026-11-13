import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Bot, Copy, KeyRound, RefreshCw, Server, ShieldCheck } from 'lucide-react'
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
import { Select } from '@/components/ui/select'
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
  void navigator.clipboard.writeText(t).then(() => toast.success('Copiado.'))
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

function Trecho({ texto, testId }: { texto: string; testId?: string }): ReactNode {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-bg p-2">
      <pre
        className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-2xs text-text"
        data-testid={testId}
      >
        {texto}
      </pre>
      <Button type="button" size="sm" variant="secondary" onClick={() => copiar(texto)}>
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
    <p className="text-text-dim">
      Gere um token abaixo — ele entra automaticamente no texto para copiar.
    </p>
  ) : null
  const avisoOauth =
    oauth === 'off' ? (
      <p className="text-warn">
        O login por conta não respondeu agora — confira se o servidor MCP está no ar (botão
        Verificar). Enquanto isso, use um cliente com token (Claude Code, Cursor, n8n).
      </p>
    ) : null
  switch (cliente) {
    case 'claude_ai':
      return (
        <div className="space-y-2">
          {avisoOauth}
          <ol className="list-decimal space-y-1 pl-4 text-text-muted">
            <li>
              Claude.ai ou Claude Desktop › Configurações › Conectores › Adicionar conector
              personalizado.
            </li>
            <li>Nome: InfraWork. URL do servidor:</li>
          </ol>
          <Trecho texto={MCP_URL} />
          <p className="text-text-muted">
            Ao conectar, entre com a sua conta do InfraWork e clique em <strong>Permitir</strong>.
          </p>
        </div>
      )
    case 'chatgpt':
      return (
        <div className="space-y-2">
          {avisoOauth}
          <ol className="list-decimal space-y-1 pl-4 text-text-muted">
            <li>
              ChatGPT › Configurações › Aplicativos e conectores › modo desenvolvedor › Criar.
            </li>
            <li>URL do servidor MCP (autenticação OAuth):</li>
          </ol>
          <Trecho texto={MCP_URL} />
          <p className="text-text-muted">Entre com a sua conta do InfraWork e permita o acesso.</p>
        </div>
      )
    case 'claude_code':
      return (
        <div className="space-y-2">
          <p className="text-text-muted">No terminal:</p>
          <Trecho
            testId="instr-claude-code"
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
          <Trecho texto={MCP_URL} />
          <Trecho texto={`Authorization: Bearer ${tk}`} />
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

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    setErro(null)
    setNovo(null)
    criar.mutate(
      { nome: nome.trim(), dias: dias === 'sem' ? null : Number(dias) },
      {
        onSuccess: (t) => {
          setNovo(t)
          setNome('')
        },
        onError: (e) => setErro(e.message)
      }
    )
  }

  const cards: { icone: ReactNode; titulo: string; estado: Estado; texto: ReactNode }[] = [
    {
      icone: <Server size={12} />,
      titulo: 'Servidor MCP',
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
      titulo: 'Login OAuth',
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
      texto: `${contar(status.ativos.length, 'ativo', 'ativos')} · último uso ${dataBR(status.ultimoUso)}`
    }
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <DialogHeader>
        <DialogTitle>
          <span className="inline-flex items-center gap-1.5">
            <Bot size={13} /> Conectar IA ao InfraWork (MCP)
          </span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4 text-xs">
        <div className="grid grid-cols-3 gap-2" data-testid="mcp-status">
          {cards.map((c) => (
            <div key={c.titulo} className="rounded border border-border bg-bg-elevated p-2.5">
              <div className="flex items-center gap-1.5 text-2xs font-mono uppercase text-text-dim">
                {c.icone} {c.titulo}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-text">
                <PontoEstado estado={c.estado} /> {c.texto}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Endereço:</span>
          <button
            type="button"
            className="font-mono text-accent hover:underline"
            onClick={() => copiar(MCP_URL)}
          >
            {MCP_URL}
          </button>
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={recarregar}>
            <RefreshCw size={12} /> Verificar
          </Button>
        </div>
        <p className="text-text-muted">
          A IA age com as suas permissões no InfraWork. Ações que apagam ou mexem em muita coisa
          pedem confirmação.
        </p>

        <div className="space-y-2">
          <div className="text-2xs font-mono uppercase text-text-dim">Como conectar</div>
          <div className="flex flex-wrap gap-1" role="tablist">
            {CLIENTES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={cliente === c.id}
                onClick={() => setCliente(c.id)}
                className={cn(
                  'rounded border px-2 py-1 text-2xs',
                  cliente === c.id
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:text-text'
                )}
              >
                {c.nome}
                <span className="ml-1 text-text-dim">{c.oauth ? '· login' : '· token'}</span>
              </button>
            ))}
          </div>
          <div className="rounded border border-border bg-bg-elevated p-3">
            <Instrucoes cliente={cliente} token={novo} oauth={status.oauth} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-2xs font-mono uppercase text-text-dim">Tokens pessoais</div>
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="tk-nome">Novo token</Label>
              <Input
                id="tk-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Claude Code no notebook"
                required
                maxLength={80}
              />
            </div>
            <div className="w-36">
              <Label htmlFor="tk-dias">Validade</Label>
              <Select id="tk-dias" value={dias} onChange={(e) => setDias(e.target.value)}>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">1 ano</option>
                <option value="sem">Sem validade</option>
              </Select>
            </div>
            <Button type="submit" disabled={criar.isPending || !nome.trim()}>
              Gerar
            </Button>
          </form>
          <DialogErrorBanner message={erro} />
          {novo ? (
            <div className="space-y-1.5 rounded border border-warn/40 bg-warn/10 p-3">
              <div className="font-semibold text-warn">
                Copie agora — o token não aparece de novo. Ele já está nas instruções acima.
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
              <tr className="text-left text-2xs font-mono uppercase text-text-dim">
                <th className="py-1 font-normal">Nome</th>
                <th className="py-1 font-normal">Início</th>
                <th className="py-1 font-normal">Criado</th>
                <th className="py-1 font-normal">Expira</th>
                <th className="py-1 font-normal">Último uso</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {status.ativos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-text-dim">
                    Nenhum token ativo.
                  </td>
                </tr>
              ) : (
                status.ativos.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 text-text">
                      {t.nome}
                      {t.tipo === 'oauth' ? (
                        <span className="ml-1.5 rounded bg-accent/15 px-1 text-2xs text-accent">
                          login
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 font-mono text-text-muted">{t.prefixo}…</td>
                    <td className="py-1.5 text-text-muted">{dataBR(t.criado_em)}</td>
                    <td className="py-1.5 text-text-muted">{dataBR(validade(t))}</td>
                    <td className="py-1.5 text-text-muted">{dataBR(t.ultimo_uso_em)}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={revogar.isPending}
                        onClick={() =>
                          revogar.mutate(t.id, {
                            onSuccess: () => toast.success('Token revogado.'),
                            onError: (e) => toast.error(e.message)
                          })
                        }
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
