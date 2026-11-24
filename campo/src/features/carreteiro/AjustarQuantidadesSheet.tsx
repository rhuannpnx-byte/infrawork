import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { NumericField } from '@/features/common/fields'
import { focarPrimeiroInvalido, useFolha } from '@/features/common/useFolha'
import { cn } from '@/lib/cn'
import { formatNumero } from '@/lib/datas'
import { parseNum } from '@/lib/numero'
import { contar } from '@/lib/texto'

type Opcao = 'manter' | 'capacidade' | 'valor'

interface Props {
  /** viagens já lançadas na ficha, e quantas delas aceitam o valor único (as de serviço por peso não aceitam) */
  viagens: number
  ajustaveis: number
  /** capacidade do cadastro do caminhão da ficha, em m³ (null = sem capacidade no cadastro) */
  capacidade: number | null
  /** null = manter as quantidades; número = o valor que vai para todas as viagens ajustáveis */
  onConfirm: (valor: number | null) => void
  onDismiss: () => void
}

/**
 * Ao salvar a edição de uma ficha que já tem viagens: o que fazer com a quantidade delas. Trocar o caminhão muda a
 * caçamba, então o apontador escolhe entre manter o que lançou, usar a capacidade do cadastro ou digitar um valor só.
 */
export function AjustarQuantidadesSheet({
  viagens,
  ajustaveis,
  capacidade,
  onConfirm,
  onDismiss,
}: Props) {
  const [opcao, setOpcao] = useState<Opcao>('manter')
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const folhaRef = useFolha<HTMLFormElement>(true, onDismiss)
  const tituloId = useId()
  const temCapacidade = capacidade != null && capacidade > 0
  const semAjuste = ajustaveis === 0

  function salvar() {
    if (opcao === 'manter') return onConfirm(null)
    if (opcao === 'capacidade') return onConfirm(capacidade)
    const n = parseNum(valor)
    if (n == null || n <= 0) {
      flushSync(() => setErro('Informe a quantidade de cada viagem.'))
      return focarPrimeiroInvalido(folhaRef.current)
    }
    onConfirm(n)
  }

  const opcoes: Array<{ id: Opcao; titulo: string; apoio: string; bloqueio?: string }> = [
    {
      id: 'manter',
      titulo: 'Manter as quantidades',
      apoio: 'As viagens ficam como foram lançadas.',
    },
    {
      id: 'capacidade',
      titulo: temCapacidade
        ? `Usar a capacidade do cadastro (${formatNumero(capacidade, 2)} m³)`
        : 'Usar a capacidade do cadastro',
      apoio: 'Todas as viagens passam a ter a capacidade do caminhão da ficha.',
      bloqueio: semAjuste
        ? 'As viagens desta ficha são de serviço por peso.'
        : temCapacidade
          ? undefined
          : 'O caminhão da ficha não tem capacidade no cadastro.',
    },
    {
      id: 'valor',
      titulo: 'Atribuir um valor único',
      apoio: 'Digite a quantidade que vale para todas as viagens.',
      bloqueio: semAjuste ? 'As viagens desta ficha são de serviço por peso.' : undefined,
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      <form
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          salvar()
        }}
        className="folha-flutuante flex max-h-[90dvh] w-full flex-col rounded-t-2xl focus-visible:ring-0 sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-start justify-between border-b border-border px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1 pr-2">
            <p className="rotulo">Salvar a ficha</p>
            <h2 id={tituloId} className="mt-1 text-lg font-semibold text-on-surface">
              A ficha já tem {contar(viagens, 'viagem lançada', 'viagens lançadas')}
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-dim">
              O que fazer com a quantidade delas?
              {ajustaveis > 0 && ajustaveis < viagens
                ? ` As de serviço por peso (${viagens - ajustaveis}) não mudam: cada uma tem o seu ticket.`
                : ''}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={tituloId}
          className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        >
          {opcoes.map((o) => {
            const marcada = opcao === o.id
            return (
              <div key={o.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={marcada}
                  disabled={!!o.bloqueio}
                  onClick={() => {
                    setOpcao(o.id)
                    setErro(null)
                  }}
                  className={cn(
                    'flex min-h-touch w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left',
                    marcada ? 'border-accent bg-accent/10' : 'border-border-strong bg-bg-panel',
                    o.bloqueio && 'cursor-not-allowed bg-bg-elevated',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                      marcada ? 'border-accent' : 'border-border-strong',
                    )}
                  >
                    {marcada && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-sm font-semibold',
                        o.bloqueio ? 'text-on-surface-dim' : 'text-on-surface',
                      )}
                    >
                      {o.titulo}
                    </span>
                    <span className="block text-xs text-on-surface-dim">
                      {o.bloqueio ?? o.apoio}
                    </span>
                  </span>
                </button>
                {o.id === 'valor' && marcada && (
                  <div className="mt-2 pl-8">
                    <NumericField
                      label="Quantidade de cada viagem *"
                      value={valor}
                      onChange={(v) => {
                        setValor(v)
                        setErro(null)
                      }}
                      erro={erro ?? undefined}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex gap-2 border-t border-border p-4 pb-safe-plus-4">
          <Button type="button" variant="secondary" size="lg" onClick={onDismiss} className="px-4">
            Voltar
          </Button>
          <Button type="submit" variant="primary" size="lg" className="min-w-0 flex-1">
            Salvar ficha
          </Button>
        </div>
      </form>
    </div>
  )
}
