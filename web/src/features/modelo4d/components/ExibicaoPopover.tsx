import { useState, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Segmentado } from '@/components/ui/segmentado'
import type { Exibicao } from './aparencia'

/** Estilo de exibição, luz e efeitos da cena, num menu da barra. */
export function ExibicaoPopover({
  valor,
  aoMudar
}: {
  valor: Exibicao
  aoMudar: (e: Exibicao) => void
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const sol = valor.luz === 'sol'
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
          <Eye size={14} aria-hidden />
          Exibição
        </Button>
      }
    >
      <div className="flex flex-col gap-3" role="group" aria-label="Exibição da cena">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">Estilo</span>
          <Segmentado
            rotulo="Estilo de exibição"
            valor={valor.estilo}
            aoMudar={(estilo) => aoMudar({ ...valor, estilo })}
            tamanho="sm"
            opcoes={[
              {
                valor: 'realista',
                rotulo: 'Realista',
                titulo: 'Cada material com a sua textura: asfalto, concreto, solo, grama'
              },
              { valor: 'sombreado', rotulo: 'Sombreado', titulo: 'Cor lisa por material' },
              { valor: 'linhas', rotulo: 'Linhas', titulo: 'Superfícies claras com as arestas' }
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">Luz</span>
          <Segmentado
            rotulo="Luz da cena"
            valor={valor.luz}
            aoMudar={(luz) => aoMudar({ ...valor, luz })}
            tamanho="sm"
            opcoes={[
              {
                valor: 'frontal',
                rotulo: 'Frontal',
                titulo: 'A luz parte de quem olha: nenhuma face fica escura'
              },
              { valor: 'sol', rotulo: 'Sol', titulo: 'Sol do meio da tarde, com sombras' }
            ]}
          />
        </div>
        <label
          className="flex items-center gap-2 text-sm text-text"
          title={sol ? undefined : 'As sombras projetadas dependem da luz do sol'}
        >
          <input
            type="checkbox"
            checked={sol && valor.sombras}
            disabled={!sol}
            onChange={(e) => aoMudar({ ...valor, sombras: e.target.checked })}
            className="accent-[color:var(--accent)]"
          />
          Sombras projetadas
          {!sol && <span className="text-xs text-text-dim">(só com o sol)</span>}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={valor.contato}
            onChange={(e) => aoMudar({ ...valor, contato: e.target.checked })}
            className="accent-[color:var(--accent)]"
          />
          Sombra de contato entre as peças
        </label>
      </div>
    </Popover>
  )
}
