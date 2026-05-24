import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Save, Eye, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMemoriaDoItem, useUpsertMemoria } from '../hooks/memoria'
import { cn } from '@/lib/utils'

interface Props {
  itemId: string
  podeEditar: boolean
}

export function MemoriaEditor({ itemId, podeEditar }: Props): ReactNode {
  const { data: memoria, isLoading } = useMemoriaDoItem(itemId)
  const upsert = useUpsertMemoria()

  const [editing, setEditing] = useState(false)
  const [bodyMd, setBodyMd] = useState('')
  const [estIni, setEstIni] = useState('')
  const [estFim, setEstFim] = useState('')
  const [hidratado, setHidratado] = useState(false)

  // Hidrata state a partir da query (sem useEffect)
  if (!hidratado && !isLoading) {
    setHidratado(true)
    setBodyMd(memoria?.body_md ?? '')
    setEstIni(memoria?.estaca_inicio ?? '')
    setEstFim(memoria?.estaca_fim ?? '')
  }

  const save = async (): Promise<void> => {
    try {
      await upsert.mutateAsync({
        item_id: itemId,
        body_md: bodyMd,
        estaca_inicio: estIni.trim() || null,
        estaca_fim: estFim.trim() || null
      })
      toast.success('Memória salva.')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    }
  }

  if (isLoading) {
    return <div className="text-xs text-text-muted font-mono">Carregando…</div>
  }

  const vazio = !memoria && !editing

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-mono uppercase tracking-wider text-text-dim">
          Memória de cálculo
        </h3>
        {podeEditar ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing((e) => !e)}
            disabled={upsert.isPending}
          >
            {editing ? <Eye size={11} /> : <Edit3 size={11} />}
            {editing ? 'Visualizar' : memoria ? 'Editar' : 'Criar'}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="m-est-ini">Estaca início</Label>
              <Input
                id="m-est-ini"
                value={estIni}
                onChange={(e) => setEstIni(e.target.value)}
                placeholder="km 12+200"
              />
            </div>
            <div>
              <Label htmlFor="m-est-fim">Estaca fim</Label>
              <Input
                id="m-est-fim"
                value={estFim}
                onChange={(e) => setEstFim(e.target.value)}
                placeholder="km 47+850"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="m-body">Texto (Markdown)</Label>
            <textarea
              id="m-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={10}
              className="w-full rounded border border-border-strong bg-bg-elevated px-2 py-1.5 text-xs text-text font-mono placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent resize-y"
              placeholder={'## Levantamento\n\nÁrea = base × altura = 1500 × 8 = 12.000 m²\n...'}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={save}
              disabled={upsert.isPending}
            >
              <Save size={11} /> {upsert.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {memoria?.estaca_inicio || memoria?.estaca_fim ? (
            <div className="text-2xs text-text-dim font-mono">
              Trecho: {memoria.estaca_inicio ?? '?'} → {memoria.estaca_fim ?? '?'}
            </div>
          ) : null}
          {vazio ? (
            <div className="text-text-muted font-mono italic">
              Nenhuma memória registrada para este item.
            </div>
          ) : (
            <div
              className={cn(
                'rounded border border-border bg-bg-elevated px-3 py-2 font-mono whitespace-pre-wrap',
                'text-text leading-relaxed max-h-72 overflow-auto'
              )}
            >
              {memoria?.body_md || <span className="text-text-muted italic">(vazio)</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
