import { useState, type ReactNode } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Popover } from '@/components/ui/popover'
import type { Vista } from './vistas'

export function VistasPopover({
  vistas,
  aoSalvar,
  aoAplicar,
  aoExcluir
}: {
  vistas: Vista[]
  aoSalvar: (nome: string) => void
  aoAplicar: (v: Vista) => void
  aoExcluir: (id: string) => void
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  return (
    <Popover
      open={aberto}
      onOpenChange={setAberto}
      align="end"
      className="w-72 p-3"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={aberto}
          aria-haspopup="dialog"
          onClick={() => setAberto((v) => !v)}
        >
          <Bookmark size={14} aria-hidden />
          Vistas
        </Button>
      }
    >
      <div className="flex flex-col gap-3" role="group" aria-label="Vistas salvas">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!nome.trim()) return
            aoSalvar(nome.trim())
            setNome('')
          }}
        >
          <Input
            aria-label="Nome da vista"
            placeholder="Nome da vista"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="h-7 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!nome.trim()}
            title={nome.trim() ? undefined : 'Dê um nome para salvar a vista atual'}
          >
            Salvar
          </Button>
        </form>
        {vistas.length === 0 ? (
          <p className="text-sm text-text-muted">
            Salve a vista atual (câmera, data, modo e o que está oculto) para voltar a ela depois.
            As vistas ficam neste navegador.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {vistas.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    aoAplicar(v)
                    setAberto(false)
                  }}
                  className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm text-text hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {v.nome}
                </button>
                <IconButton
                  aria-label={`Excluir a vista ${v.nome}`}
                  onClick={() => aoExcluir(v.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  )
}
