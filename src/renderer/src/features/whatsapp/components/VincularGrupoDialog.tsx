import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Users, Search, Check } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useAtualizarGrupo } from '@/features/whatsapp/hooks'
import type { WhatsAppGrupo } from '@/types/whatsapp'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Todos os grupos descobertos (a lista é filtrada para os ainda não vinculados). */
  grupos: WhatsAppGrupo[]
}

/** Modal para criar um vínculo grupo → obra (ativa o monitoramento). */
export function VincularGrupoDialog({ open, onOpenChange, grupos }: Props): ReactNode {
  const obras = useAuthStore((s) => s.obras)
  const atualizar = useAtualizarGrupo()

  const [filtro, setFiltro] = useState('')
  const [grupoId, setGrupoId] = useState<string | null>(null)
  const [obraId, setObraId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Disponíveis = grupos ainda não vinculados/monitorados.
  const disponiveis = useMemo(() => grupos.filter((g) => !(g.monitorar && g.obra_id)), [grupos])
  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return disponiveis
    return disponiveis.filter((g) => (g.nome ?? g.wa_group_jid).toLowerCase().includes(q))
  }, [disponiveis, filtro])

  function reset(): void {
    setFiltro('')
    setGrupoId(null)
    setObraId('')
    setError(null)
  }

  async function vincular(): Promise<void> {
    if (!grupoId || !obraId) {
      setError('Selecione um grupo e uma obra.')
      return
    }
    setError(null)
    try {
      await atualizar.mutateAsync({ id: grupoId, monitorar: true, obra_id: obraId })
      toast.success('Grupo vinculado — monitoramento ativado.')
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao vincular')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={atualizar.isPending}
    >
      <DialogHeader>
        <DialogTitle>Novo vínculo de grupo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <DialogErrorBanner message={error} />

        {/* Passo 1 — escolher o grupo */}
        <div className="space-y-2">
          <div className="text-2xs font-mono uppercase text-text-dim">1. Selecione o grupo</div>
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
            />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar pelo nome do grupo…"
              className="pl-7"
            />
          </div>
          <div className="max-h-64 overflow-auto rounded border border-border bg-bg-panel divide-y divide-border/40">
            {filtrados.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGrupoId(g.id)}
                className={cn(
                  'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-bg-hover',
                  grupoId === g.id && 'bg-accent/10'
                )}
              >
                <Users size={12} className="text-text-dim shrink-0" />
                <span className="flex-1 truncate text-xs text-text">
                  {g.nome ?? g.wa_group_jid}
                </span>
                <span className="text-2xs font-mono text-text-dim">{g.participantes ?? '—'}</span>
                {grupoId === g.id ? <Check size={12} className="text-accent shrink-0" /> : null}
              </button>
            ))}
            {filtrados.length === 0 ? (
              <div className="px-3 py-6 text-center text-2xs text-text-dim italic">
                {disponiveis.length === 0
                  ? 'Todos os grupos já estão vinculados.'
                  : 'Nenhum grupo encontrado.'}
              </div>
            ) : null}
          </div>
        </div>

        {/* Passo 2 — escolher a obra */}
        <div className="space-y-2">
          <div className="text-2xs font-mono uppercase text-text-dim">2. Vincule a uma obra</div>
          <Select value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">— selecione a obra —</option>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>
                {o.codigo} - {o.nome}
              </option>
            ))}
          </Select>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={atualizar.isPending}
        >
          Cancelar
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={vincular}
          disabled={!grupoId || !obraId || atualizar.isPending}
        >
          {atualizar.isPending ? 'Vinculando…' : 'Vincular'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
