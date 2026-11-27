// O lançamento de produção em si: as abas (Lançar, Em lote; no celular, Lançar e Do dia), o formulário e a lista
// do dia. É o miolo do modal "Lançar produção" da página Produção e da tela do modo campo (/lancar).

import { useMemo, useState, type ReactNode } from 'react'
import { ClipboardList, ListChecks, Table2 } from 'lucide-react'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { hojeLocalISO } from '@/lib/format/local-date'
import { cn } from '@/lib/utils'
import { useLancamentosDia } from '../../hooks/lancamento'
import { LancamentoBulkGrid } from './LancamentoBulkGrid'
import { LancamentoForm } from './LancamentoForm'
import { LancamentosDoDia } from './LancamentosDoDia'

type Aba = 'lancar' | 'dia' | 'lote'

/** Como o lançamento abre: numa aba, num dia ou já editando um lançamento. */
export interface InicioLancamento {
  aba?: string | null
  /** id do lançamento a editar (o registro vem da lista do dia) */
  editarId?: string | null
  /** dia em AAAA-MM-DD; sem isso, hoje */
  data?: string | null
}

interface Props {
  obraId: string
  inicio?: InicioLancamento
  /** o que fica à direita das abas (ex.: o atalho do modo campo) */
  acoes?: ReactNode
  className?: string
}

export function LancarProducao({ obraId, inicio, acoes, className }: Props): ReactNode {
  const mobile = useIsMobile()
  const [abaEscolhida, setAba] = useState<Aba>(() =>
    inicio?.aba === 'lote' || inicio?.aba === 'dia' ? inicio.aba : 'lancar'
  )
  const [data, setData] = useState<string>(() =>
    inicio?.data && /^\d{4}-\d{2}-\d{2}$/.test(inicio.data) ? inicio.data : hojeLocalISO()
  )
  // Edição: guarda só o id; o registro vem da lista do dia.
  const [editandoId, setEditandoId] = useState<string | null>(inicio?.editarId ?? null)

  const { data: doDia = [] } = useLancamentosDia(obraId, data)
  const editando = editandoId ? (doDia.find((x) => x.id === editandoId) ?? null) : null

  // No celular só existem Lançar e Do dia; no desktop, Lançar (com o dia ao lado) e Em lote.
  const aba: Aba = mobile
    ? abaEscolhida === 'lote'
      ? 'lancar'
      : abaEscolhida
    : abaEscolhida === 'dia'
      ? 'lancar'
      : abaEscolhida
  const abas = useMemo<Array<{ k: Aba; label: string; icon: ReactNode }>>(
    () =>
      mobile
        ? [
            { k: 'lancar', label: 'Lançar', icon: <ClipboardList size={13} /> },
            { k: 'dia', label: 'Do dia', icon: <ListChecks size={13} /> }
          ]
        : [
            { k: 'lancar', label: 'Lançar', icon: <ClipboardList size={13} /> },
            { k: 'lote', label: 'Em lote', icon: <Table2 size={13} /> }
          ],
    [mobile]
  )

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        className={cn(
          'border-b border-border bg-bg-panel flex items-center gap-1',
          mobile ? 'px-2' : 'px-5'
        )}
      >
        <div
          role="tablist"
          aria-label="Forma de lançar"
          className={cn('flex items-center gap-1', mobile && 'flex-1')}
        >
          {abas.map((a) => (
            <button
              key={a.k}
              type="button"
              role="tab"
              aria-selected={aba === a.k}
              onClick={() => setAba(a.k)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                mobile && 'flex-1 justify-center',
                aba === a.k
                  ? 'border-accent text-accent font-semibold'
                  : 'border-transparent text-text-muted hover:text-text'
              )}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        {acoes && !mobile ? <div className="ml-auto flex items-center gap-1.5">{acoes}</div> : null}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {aba === 'lancar' ? (
          mobile ? (
            <div className="h-full overflow-auto">
              <LancamentoForm
                obraId={obraId}
                editar={editando}
                data={data}
                onDataChange={setData}
                onSalvo={() => {
                  setEditandoId(null)
                  setAba('dia')
                }}
                onCancelarEdicao={() => setEditandoId(null)}
                compacto
              />
            </div>
          ) : (
            <div className="h-full grid grid-cols-1 xl:grid-cols-[minmax(0,560px)_1fr]">
              <div className="h-full overflow-auto border-r border-border">
                <LancamentoForm
                  obraId={obraId}
                  editar={editando}
                  data={data}
                  onDataChange={setData}
                  onSalvo={() => setEditandoId(null)}
                  onCancelarEdicao={() => setEditandoId(null)}
                />
              </div>
              <div className="h-full overflow-auto bg-bg">
                <LancamentosDoDia
                  obraId={obraId}
                  data={data}
                  onEditar={(p) => {
                    setData(p.data)
                    setEditandoId(p.id)
                  }}
                />
              </div>
            </div>
          )
        ) : null}
        {aba === 'dia' ? (
          <div className="h-full overflow-auto">
            <div className="px-4 pt-3">
              <Input
                type="date"
                aria-label="Dia dos lançamentos"
                value={data}
                max={hojeLocalISO()}
                onChange={(e) => setData(e.target.value)}
                className="h-10 px-3"
              />
            </div>
            <LancamentosDoDia
              obraId={obraId}
              data={data}
              compacto
              onEditar={(p) => {
                setData(p.data)
                setEditandoId(p.id)
                setAba('lancar')
              }}
            />
          </div>
        ) : null}
        {aba === 'lote' ? <LancamentoBulkGrid obraId={obraId} dataInicial={data} /> : null}
      </div>
    </div>
  )
}

interface DialogProps {
  obraId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  inicio?: InicioLancamento
  acoes?: ReactNode
}

/**
 * O lançamento num modal, sobre a página Produção. Clicar fora não fecha: quem está no meio de um lote digitado
 * não pode perder tudo por um clique solto; fecha no X ou no Esc.
 */
export function LancarProducaoDialog({
  obraId,
  open,
  onOpenChange,
  inicio,
  acoes
}: DialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="full"
      manterAoClicarFora
      className="max-w-[1400px]"
    >
      <DialogHeader className="shrink-0">
        <DialogTitle>Lançar produção</DialogTitle>
        <DialogDescription>Registre o executado do dia por serviço do orçamento.</DialogDescription>
      </DialogHeader>
      <LancarProducao obraId={obraId} inicio={inicio} acoes={acoes} className="flex-1" />
    </Dialog>
  )
}
