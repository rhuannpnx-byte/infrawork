import { type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useGrantPermissao, useObras, useRevokePermissao } from '../hooks'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
}

/**
 * Obras liberadas para um apontador (ou cliente/engenheiro, para o adm): marca/desmarca e concede/revoga na hora.
 * O engenheiro vê só as obras dele; o servidor confere o resto (grant/revoke-obra-permissao).
 */
export function ObrasDoUsuarioDialog({ open, onOpenChange, usuario }: Props): ReactNode {
  const qc = useQueryClient()
  const obras = useObras()
  const grant = useGrantPermissao()
  const revoke = useRevokePermissao()
  const chave = ['gerencial', 'permissoes-usuario', usuario?.id]
  const perms = useQuery({
    queryKey: chave,
    enabled: open && !!usuario,
    queryFn: async (): Promise<Set<string>> => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const { data, error } = await supabase
        .from('obra_permissoes')
        .select('obra_id')
        .eq('user_id', usuario!.id)
      if (error) throw error
      return new Set((data ?? []).map((p) => p.obra_id as string))
    }
  })
  const lista = (obras.data ?? []).filter((o) => !usuario || o.empresa_id === usuario.empresa_id)
  const ocupado = grant.isPending || revoke.isPending

  const alternar = (obraId: string, liberada: boolean): void => {
    if (!usuario) return
    const fim = (): void => void qc.invalidateQueries({ queryKey: chave })
    const erro = (e: Error): void => void toast.error(e.message)
    if (liberada)
      revoke.mutate({ obra_id: obraId, user_id: usuario.id }, { onSuccess: fim, onError: erro })
    else grant.mutate({ obra_id: obraId, user_id: usuario.id }, { onSuccess: fim, onError: erro })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader>
        <DialogTitle>Obras liberadas</DialogTitle>
        <DialogDescription>
          {usuario ? `${usuario.nome} · ${usuario.email}` : ''} · marque as obras em que ele lança
          pelo app de campo.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {obras.isLoading || perms.isLoading ? (
          <p className="text-xs text-text-muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma obra disponível para liberar.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded border border-border">
            {lista.map((o) => {
              const liberada = perms.data?.has(o.id) ?? false
              return (
                <li key={o.id}>
                  <label className="flex h-9 cursor-pointer items-center gap-2.5 px-3 text-xs hover:bg-bg-hover">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={liberada}
                      disabled={ocupado}
                      onChange={() => alternar(o.id, liberada)}
                    />
                    <span className="w-20 shrink-0 font-mono text-text-muted">{o.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{o.nome}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Fechar</Button>
      </DialogFooter>
    </Dialog>
  )
}
