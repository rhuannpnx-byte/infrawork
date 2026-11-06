import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Copy, KeyRound } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { supabase } from '@/lib/supabase/client'

interface TokenIA {
  id: string
  nome: string
  prefixo: string
  criado_em: string
  expira_em: string | null
  ultimo_uso_em: string | null
  revogado_em: string | null
}

const CHAVE = ['mcp', 'tokens']
const MCP_URL = `${typeof window === 'undefined' ? '' : window.location.origin}/mcp`
const dataBR = (s: string | null): string => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')

function sb(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('Supabase não configurado.')
  return supabase
}

function copiar(t: string): void {
  void navigator.clipboard.writeText(t).then(() => toast.success('Copiado.'))
}

/** Tokens pessoais para conectar IAs (MCP) ao InfraWork com as permissões do próprio usuário. */
export function TokensIADialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): ReactNode {
  const qc = useQueryClient()
  const [nome, setNome] = useState('')
  const [dias, setDias] = useState('90')
  const [novo, setNovo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const tokens = useQuery({
    queryKey: CHAVE,
    enabled: open,
    queryFn: async (): Promise<TokenIA[]> => {
      const { data, error } = await sb()
        .from('mcp_token')
        .select('id, nome, prefixo, criado_em, expira_em, ultimo_uso_em, revogado_em')
        .order('criado_em', { ascending: false })
      if (error) throw error
      return data as TokenIA[]
    }
  })
  const criar = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await sb().rpc('mcp_token_criar', {
        _nome: nome,
        _dias: dias === 'sem' ? null : Number(dias)
      })
      if (error) throw new Error(error.message)
      return (data as { token: string }).token
    },
    onSuccess: (t) => {
      setNovo(t)
      setNome('')
      void qc.invalidateQueries({ queryKey: CHAVE })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : String(e))
  })
  const revogar = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await sb().rpc('mcp_token_revogar', { _id: id })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Token revogado.')
      void qc.invalidateQueries({ queryKey: CHAVE })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e))
  })

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    setErro(null)
    setNovo(null)
    criar.mutate()
  }

  const ativos = (tokens.data ?? []).filter((t) => !t.revogado_em)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <DialogHeader>
        <DialogTitle>
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={13} /> Conectar IA (MCP)
          </span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4 text-xs">
        <div className="rounded border border-border bg-bg-elevated p-3 space-y-1.5">
          <div className="text-text">
            Endereço do MCP do InfraWork:{' '}
            <button
              type="button"
              className="font-mono text-accent hover:underline"
              onClick={() => copiar(MCP_URL)}
            >
              {MCP_URL}
            </button>
          </div>
          <p className="text-text-muted">
            Claude.ai, Claude Desktop e ChatGPT: adicione como conector personalizado com esse
            endereço e entre com a sua conta (OAuth). IDEs e agentes (Claude Code, Cursor, n8n…):
            use o endereço com um token abaixo no cabeçalho <code>Authorization: Bearer</code>. A IA
            age com as suas permissões.
          </p>
        </div>

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
          <div className="rounded border border-warn/40 bg-warn/10 p-3 space-y-1.5">
            <div className="text-warn font-semibold">
              Copie agora — o token não aparece de novo.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-text" data-testid="token-novo">
                {novo}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={() => copiar(novo)}>
                <Copy size={11} /> Copiar
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
            {ativos.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-text-dim">
                  Nenhum token ativo.
                </td>
              </tr>
            ) : (
              ativos.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 text-text">{t.nome}</td>
                  <td className="py-1.5 font-mono text-text-muted">{t.prefixo}…</td>
                  <td className="py-1.5 text-text-muted">{dataBR(t.criado_em)}</td>
                  <td className="py-1.5 text-text-muted">{dataBR(t.expira_em)}</td>
                  <td className="py-1.5 text-text-muted">{dataBR(t.ultimo_uso_em)}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={revogar.isPending}
                      onClick={() => revogar.mutate(t.id)}
                    >
                      Revogar
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
