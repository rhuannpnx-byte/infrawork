import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Save, X, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { useMemoriaDoItem, useUpsertMemoria } from '../hooks/memoria'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  itemId: string
  podeEditar: boolean
}

export function MemoriaEditor({ itemId, podeEditar }: Props): ReactNode {
  const { data: memoria, isLoading, error, refetch } = useMemoriaDoItem(itemId)
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
      toast.success('Memória de cálculo salva.')
      setEditing(false)
    } catch (err) {
      toast.error(
        `Não foi possível salvar a memória de cálculo. ${detalheDoErro(err) ?? ''}`.trim()
      )
    }
  }

  if (isLoading) return <Carregando className="py-2" />
  if (error)
    return (
      <ErroConsulta
        erro={error}
        oQue="a memória de cálculo"
        aoTentar={() => void refetch()}
        compacto
      />
    )

  const vazio = !memoria && !editing

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
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
            {editing ? <X size={12} aria-hidden /> : <Edit3 size={12} aria-hidden />}
            {editing ? 'Fechar edição' : memoria ? 'Editar' : 'Criar memória'}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Estaca inicial">
              <Input
                id="m-est-ini"
                value={estIni}
                onChange={(e) => setEstIni(e.target.value)}
                placeholder="km 12+200"
              />
            </Campo>
            <Campo rotulo="Estaca final">
              <Input
                id="m-est-fim"
                value={estFim}
                onChange={(e) => setEstFim(e.target.value)}
                placeholder="km 47+850"
              />
            </Campo>
          </div>
          <Campo rotulo="Texto" dica="Aceita Markdown (títulos com ##, listas com -).">
            <textarea
              id="m-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={10}
              className="w-full rounded border border-border-strong bg-bg-panel px-2.5 py-1.5 text-sm text-text tabular placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent resize-y"
              placeholder={'## Levantamento\n\nÁrea = base × altura = 1500 × 8 = 12.000 m²\n...'}
            />
          </Campo>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={save}
              disabled={upsert.isPending}
            >
              <Save size={12} aria-hidden /> {upsert.isPending ? 'Salvando…' : 'Salvar memória'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {memoria?.estaca_inicio || memoria?.estaca_fim ? (
            <p className="text-sm text-text-muted">
              Trecho: da estaca {memoria.estaca_inicio ?? 'não informada'} à estaca{' '}
              {memoria.estaca_fim ?? 'não informada'}
            </p>
          ) : null}
          {vazio ? (
            <Vazio className="py-2">
              Este item ainda não tem memória de cálculo.
              {podeEditar ? ' Use "Criar memória" para registrar o levantamento.' : ''}
            </Vazio>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Texto da memória de cálculo"
              className="rounded border border-border bg-bg-elevated px-3 py-2 tabular whitespace-pre-wrap text-text leading-relaxed max-h-72 overflow-auto"
            >
              {memoria?.body_md || <span className="text-text-muted">Sem texto.</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
