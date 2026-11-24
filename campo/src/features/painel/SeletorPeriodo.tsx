import { useId } from 'react'
import { cn } from '@/lib/cn'
import { formatBR } from '@/lib/datas'
import {
  atalhoDisponivel,
  periodoEmVigor,
  rotuloPeriodo,
  usePeriodoPainel,
  type AtalhoPeriodo,
} from './periodo'

const ATALHOS: Array<{ id: AtalhoPeriodo; rotulo: string }> = [
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes-anterior', rotulo: 'Mês passado' },
  { id: 'tudo', rotulo: 'Tudo' },
]

const CHIP = 'min-h-touch flex-shrink-0 rounded-md border px-3 text-sm'
const chip = (ativo: boolean, bloqueado = false): string =>
  cn(
    CHIP,
    ativo
      ? 'border-accent bg-accent/10 font-semibold text-on-surface'
      : 'border-border-strong bg-bg-panel text-on-surface-dim',
    bloqueado && 'cursor-not-allowed bg-bg-elevated',
  )

/**
 * Período das telas da Visão estratégica: atalhos e "Escolher" (duas datas). A escolha é a mesma em todas as telas.
 * `desde` é o dia mais antigo que o servidor entrega; nada antes dele pode ser escolhido.
 */
export function SeletorPeriodo({
  hoje,
  desde,
  noBloco = false,
}: {
  hoje: string
  desde: string
  /** dentro de um bloco (respiro de 12 px), em vez de direto na página (16 px) */
  noBloco?: boolean
}) {
  const escolha = usePeriodoPainel((s) => s.escolha)
  const livre = usePeriodoPainel((s) => s.livre)
  const setAtalho = usePeriodoPainel((s) => s.setAtalho)
  const setLivre = usePeriodoPainel((s) => s.setLivre)
  const periodo = periodoEmVigor(escolha, livre, hoje, desde)
  const idDe = useId()
  const idAte = useId()
  const emVigor = escolha !== 'livre' && !atalhoDisponivel(escolha, hoje, desde) ? 'tudo' : escolha

  return (
    <div role="group" aria-label="Período" data-testid="painel-periodo">
      <div className="flex items-baseline justify-between gap-2">
        <p className="rotulo">Período</p>
        <p className="tabular text-xs text-on-surface-dim" data-testid="painel-periodo-rotulo">
          {rotuloPeriodo(periodo)}
        </p>
      </div>
      <div
        className={cn(
          'mt-1 flex gap-2 overflow-x-auto pb-1',
          noBloco ? '-mx-3 px-3' : '-mx-4 px-4',
        )}
      >
        {ATALHOS.map((a) => {
          const disponivel = atalhoDisponivel(a.id, hoje, desde)
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={emVigor === a.id}
              disabled={!disponivel}
              title={
                disponivel ? undefined : `O aplicativo guarda a produção desde ${formatBR(desde)}`
              }
              onClick={() => setAtalho(a.id)}
              className={chip(emVigor === a.id, !disponivel)}
            >
              {a.rotulo}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={escolha === 'livre'}
          onClick={() => setLivre(periodo)}
          className={chip(escolha === 'livre')}
        >
          Escolher
        </button>
      </div>
      {escolha === 'livre' && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(
            [
              { id: idDe, rotulo: 'De', campo: 'de' },
              { id: idAte, rotulo: 'Até', campo: 'ate' },
            ] as const
          ).map((c) => (
            <div key={c.campo}>
              <label className="rotulo block" htmlFor={c.id}>
                {c.rotulo}
              </label>
              <input
                id={c.id}
                type="date"
                value={periodo[c.campo]}
                min={desde}
                max={hoje}
                onChange={(e) =>
                  e.target.value && setLivre({ ...periodo, [c.campo]: e.target.value })
                }
                className="tabular mt-1 block min-h-touch w-full rounded-md border border-border-strong bg-bg-panel px-3 text-base text-on-surface focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0"
              />
            </div>
          ))}
          <p className="col-span-2 text-xs text-on-surface-dim">
            O aplicativo guarda a produção desde {formatBR(desde)}.
          </p>
        </div>
      )}
    </div>
  )
}
