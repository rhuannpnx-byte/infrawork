import { useId, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { PickerField } from '@/features/common/fields'
import { useFolha } from '@/features/common/useFolha'
import { cn } from '@/lib/cn'
import { formatBR } from '@/lib/datas'
import {
  atalhoDisponivel,
  cortar,
  periodoDoAtalho,
  periodoEmVigor,
  rotuloPeriodo,
  usePeriodoPainel,
  type AtalhoPeriodo,
  type Periodo,
} from './periodo'

const ATALHOS: Array<{ id: AtalhoPeriodo; rotulo: string }> = [
  { id: '7d', rotulo: 'Últimos 7 dias' },
  { id: '30d', rotulo: 'Últimos 30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes-anterior', rotulo: 'Mês passado' },
  { id: 'tudo', rotulo: 'Tudo' },
]

const CAMPO_DATA =
  'tabular mt-1 block min-h-touch w-full rounded-md border border-border-strong bg-bg-panel px-3 text-base text-on-surface focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0'

/**
 * Período das telas da Visão estratégica: um campo só, como os de Serviço e Equipe, que abre a folha com os atalhos
 * e a opção de escolher as datas. A escolha é a mesma em todas as telas. `desde` é o dia mais antigo que o servidor
 * entrega; nada antes dele pode ser escolhido.
 */
export function SeletorPeriodo({ hoje, desde }: { hoje: string; desde: string }) {
  const escolha = usePeriodoPainel((s) => s.escolha)
  const livre = usePeriodoPainel((s) => s.livre)
  const periodo = periodoEmVigor(escolha, livre, hoje, desde)
  const [aberta, setAberta] = useState(false)
  const emVigor = escolha !== 'livre' && !atalhoDisponivel(escolha, hoje, desde) ? 'tudo' : escolha
  const nome = ATALHOS.find((a) => a.id === emVigor)?.rotulo
  return (
    <div data-testid="painel-periodo">
      <PickerField
        label="Período"
        value={nome ? `${nome} · ${rotuloPeriodo(periodo)}` : rotuloPeriodo(periodo)}
        onClick={() => setAberta(true)}
      />
      {aberta && (
        <FolhaPeriodo
          hoje={hoje}
          desde={desde}
          emVigor={emVigor}
          periodo={periodo}
          onDismiss={() => setAberta(false)}
        />
      )}
    </div>
  )
}

function FolhaPeriodo({
  hoje,
  desde,
  emVigor,
  periodo,
  onDismiss,
}: {
  hoje: string
  desde: string
  emVigor: AtalhoPeriodo | 'livre'
  periodo: Periodo
  onDismiss: () => void
}) {
  const setAtalho = usePeriodoPainel((s) => s.setAtalho)
  const setLivre = usePeriodoPainel((s) => s.setLivre)
  const folhaRef = useFolha<HTMLDivElement>(true, onDismiss)
  const tituloId = useId()
  const idDe = useId()
  const idAte = useId()
  // as datas só valem ao tocar em "Aplicar": dá para acertar as duas antes de a tela recalcular
  const [datas, setDatas] = useState(emVigor === 'livre')
  const [de, setDe] = useState(periodo.de)
  const [ate, setAte] = useState(periodo.ate)

  const linha = (marcada: boolean) =>
    cn(
      'flex min-h-touch w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left',
      marcada && 'bg-accent/10',
    )
  const marca = (marcada: boolean) => (
    <Check
      aria-hidden
      className={cn('h-5 w-5 flex-shrink-0', marcada ? 'text-accent' : 'invisible')}
    />
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      <div
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className="folha-flutuante flex max-h-[90dvh] w-full flex-col rounded-t-2xl focus-visible:ring-0 sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-3">
          <h2 id={tituloId} className="text-lg font-semibold text-on-surface">
            Período
          </h2>
          <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto" role="radiogroup" aria-labelledby={tituloId}>
          {ATALHOS.filter((a) => atalhoDisponivel(a.id, hoje, desde)).map((a) => {
            const marcada = emVigor === a.id && !datas
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={marcada}
                onClick={() => {
                  setAtalho(a.id)
                  onDismiss()
                }}
                className={linha(marcada)}
              >
                <span className="min-w-0 flex-1 text-base text-on-surface">{a.rotulo}</span>
                <span className="tabular flex-shrink-0 text-xs text-on-surface-dim">
                  {rotuloPeriodo(periodoDoAtalho(a.id, hoje, desde))}
                </span>
                {marca(marcada)}
              </button>
            )
          })}
          <button
            type="button"
            role="radio"
            aria-checked={datas}
            onClick={() => setDatas(true)}
            className={linha(datas)}
          >
            <span className="min-w-0 flex-1 text-base text-on-surface">Escolher as datas</span>
            {marca(datas)}
          </button>
          {datas && (
            <div className="space-y-3 px-4 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="rotulo block" htmlFor={idDe}>
                    De
                  </label>
                  <input
                    id={idDe}
                    type="date"
                    value={de}
                    min={desde}
                    max={hoje}
                    onChange={(e) => e.target.value && setDe(e.target.value)}
                    className={CAMPO_DATA}
                  />
                </div>
                <div>
                  <label className="rotulo block" htmlFor={idAte}>
                    Até
                  </label>
                  <input
                    id={idAte}
                    type="date"
                    value={ate}
                    min={desde}
                    max={hoje}
                    onChange={(e) => e.target.value && setAte(e.target.value)}
                    className={CAMPO_DATA}
                  />
                </div>
              </div>
              <p className="text-xs text-on-surface-dim">
                O aplicativo guarda a produção desde {formatBR(desde)}.
              </p>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => {
                  setLivre(cortar({ de, ate }, hoje, desde))
                  onDismiss()
                }}
              >
                Aplicar
              </Button>
            </div>
          )}
        </div>
        <div className="pb-safe" />
      </div>
    </div>
  )
}
