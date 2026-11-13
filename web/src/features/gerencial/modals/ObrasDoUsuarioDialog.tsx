import { useState, type ReactNode } from 'react'
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
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { supabase } from '@/lib/supabase/client'
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
      const { data, error } = await supabase
        .from('obra_permissoes')
        .select('obra_id')
        .eq('user_id', usuario!.id)
      if (error) throw error
      return new Set((data ?? []).map((p) => p.obra_id as string))
    }
  })
  const lista = (obras.data ?? []).filter((o) => !usuario || o.empresa_id === usuario.empresa_id)
  // a caixa reflete o clique na hora; volta se o servidor recusar
  const [desejado, setDesejado] = useState<Map<string, boolean>>(new Map())
  const marcar = (obraId: string, v: boolean | null): void =>
    setDesejado((m) => {
      const n = new Map(m)
      if (v === null) n.delete(obraId)
      else n.set(obraId, v)
      return n
    })

  const alternar = (obraId: string, liberada: boolean): void => {
    if (!usuario) return
    marcar(obraId, !liberada)
    const fim = (): void =>
      void qc.invalidateQueries({ queryKey: chave }).then(() => marcar(obraId, null))
    const erro = (e: Error): void => {
      marcar(obraId, null)
      toast.error(
        liberada ? 'Não foi possível retirar o acesso à obra.' : 'Não foi possível liberar a obra.',
        { description: e.message }
      )
    }
    if (liberada)
      revoke.mutate({ obra_id: obraId, user_id: usuario.id }, { onSuccess: fim, onError: erro })
    else grant.mutate({ obra_id: obraId, user_id: usuario.id }, { onSuccess: fim, onError: erro })
  }

  const erroConsulta = obras.error ?? perms.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader>
        <DialogTitle>Obras liberadas</DialogTitle>
        <DialogDescription>
          {usuario
            ? `Marque as obras em que ${usuario.nome} lança pelo app de campo. A mudança vale na hora.`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {obras.isLoading || perms.isLoading ? (
          <Carregando texto="Carregando as obras…" />
        ) : erroConsulta ? (
          <ErroConsulta
            erro={erroConsulta}
            oQue="as obras liberadas"
            aoTentar={() => {
              void obras.refetch()
              void perms.refetch()
            }}
            compacto
          />
        ) : lista.length === 0 ? (
          <Vazio>
            A empresa deste usuário ainda não tem obra cadastrada. Cadastre a obra em Obras e volte
            aqui para liberar.
          </Vazio>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded border border-border">
            {lista.map((o) => {
              const liberada = desejado.get(o.id) ?? perms.data?.has(o.id) ?? false
              return (
                <li key={o.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-bg-hover">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      checked={liberada}
                      disabled={desejado.has(o.id)}
                      onChange={() => alternar(o.id, liberada)}
                    />
                    <span className="w-24 shrink-0 truncate text-text-muted">{o.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{o.nome}</span>
                    {desejado.has(o.id) ? (
                      <span className="shrink-0 text-xs text-text-muted" role="status">
                        Salvando…
                      </span>
                    ) : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
