import { useState, type ReactNode } from 'react'
import { Clapperboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BarraAvanco } from '@/components/ui/indicador'
import { Popover } from '@/components/ui/popover'
import { Segmentado } from '@/components/ui/segmentado'
import type { OpcoesSimulacao } from './simulacao'

/** Como a simulação toca (duração, câmera, texto na cena) e a gravação em vídeo. */
export function SimulacaoPopover({
  valor,
  aoMudar,
  gravando,
  semGravacao,
  aoGravar,
  aoCancelar
}: {
  valor: OpcoesSimulacao
  aoMudar: (o: OpcoesSimulacao) => void
  /** Fração gravada (0 a 1) enquanto o vídeo é feito; `null` fora da gravação. */
  gravando: number | null
  /** Motivo de não dar para gravar neste navegador, quando há. */
  semGravacao: string | null
  aoGravar: (altura: 720 | 1080) => void
  aoCancelar: () => void
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [altura, setAltura] = useState<'720' | '1080'>('720')
  return (
    <Popover
      open={aberto}
      onOpenChange={setAberto}
      align="end"
      className="w-80 p-3"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={aberto}
          aria-haspopup="dialog"
          onClick={() => setAberto((v) => !v)}
        >
          <Clapperboard size={14} aria-hidden />
          Simulação
        </Button>
      }
    >
      <div className="flex flex-col gap-3" role="group" aria-label="Simulação da obra">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">Duração da reprodução</span>
          <Segmentado
            rotulo="Duração da reprodução"
            valor={String(valor.duracao)}
            aoMudar={(d) => aoMudar({ ...valor, duracao: Number(d) })}
            tamanho="sm"
            opcoes={[
              { valor: '30', rotulo: '30 s' },
              { valor: '60', rotulo: '1 min' },
              { valor: '120', rotulo: '2 min' },
              { valor: '300', rotulo: '5 min' }
            ]}
          />
          <p className="text-xs text-text-dim">
            Toca o plano inteiro, ou só o período destacado quando há um.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">Câmera enquanto toca</span>
          <Segmentado
            rotulo="Câmera enquanto a simulação toca"
            valor={valor.camera}
            aoMudar={(camera) => aoMudar({ ...valor, camera })}
            tamanho="sm"
            opcoes={[
              { valor: 'parada', rotulo: 'Parada', titulo: 'Fica onde você a deixou' },
              { valor: 'pista', rotulo: 'Pela pista', titulo: 'Sobrevoa a obra do começo ao fim' },
              {
                valor: 'frente',
                rotulo: 'Na frente',
                titulo: 'Acompanha o trecho com mais serviço em execução'
              }
            ]}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={valor.texto}
            onChange={(e) => aoMudar({ ...valor, texto: e.target.checked })}
            className="accent-[color:var(--accent)]"
          />
          Data e avanço escritos na cena
        </label>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-text-muted">Vídeo da simulação</span>
          {gravando == null ? (
            <div className="flex items-center gap-2">
              <Segmentado
                rotulo="Resolução do vídeo"
                valor={altura}
                aoMudar={setAltura}
                tamanho="sm"
                opcoes={[
                  { valor: '720', rotulo: '720p' },
                  { valor: '1080', rotulo: '1080p' }
                ]}
              />
              <Button
                size="sm"
                disabled={!!semGravacao}
                title={semGravacao ?? undefined}
                onClick={() => aoGravar(altura === '720' ? 720 : 1080)}
              >
                Gravar vídeo
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="min-w-0 flex-1"
                role="progressbar"
                aria-label="Gravação do vídeo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(gravando * 100)}
              >
                <BarraAvanco valor={gravando} />
              </div>
              <span className="w-10 text-right text-xs tabular text-text">
                {Math.round(gravando * 100)}%
              </span>
              <Button size="sm" variant="secondary" onClick={aoCancelar}>
                Cancelar
              </Button>
            </div>
          )}
          <p className="text-xs text-text-dim">
            {semGravacao ??
              'Grava com a duração, a câmera e o texto escolhidos. Deixe esta aba aberta até terminar.'}
          </p>
        </div>
      </div>
    </Popover>
  )
}
