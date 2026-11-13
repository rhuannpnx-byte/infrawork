import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ClipboardList, FileUp, ListChecks, Smartphone, Table2, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { contar } from '@/lib/rotulos'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { hojeLocalISO } from '@/lib/format/local-date'
import { cn } from '@/lib/utils'
import { LancamentoForm } from '@/features/acompanhamento/components/lancamento/LancamentoForm'
import { LancamentosDoDia } from '@/features/acompanhamento/components/lancamento/LancamentosDoDia'
import { LancamentoBulkGrid } from '@/features/acompanhamento/components/lancamento/LancamentoBulkGrid'
import { ImportarProducaoDialog } from '@/features/acompanhamento/components/lancamento/ImportarProducaoDialog'
import {
  useDesfazerImportacao,
  useLancamentosDia
} from '@/features/acompanhamento/hooks/lancamento'

export function AcompanhamentoLancarPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Lançar produção">
      <RequireObra pageTitle="Lançar produção">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

type Aba = 'lancar' | 'dia' | 'lote'

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const navigate = useNavigate()
  const location = useLocation()
  const bare = location.pathname === '/lancar' || location.pathname.startsWith('/lancar/')
  const mobile = useIsMobile()
  const search = useSearch({ strict: false }) as { aba?: string; editar?: string; data?: string }

  const [abaEscolhida, setAba] = useState<Aba>(() =>
    search.aba === 'lote' || search.aba === 'dia' ? search.aba : 'lancar'
  )
  const [data, setData] = useState<string>(() =>
    search.data && /^\d{4}-\d{2}-\d{2}$/.test(search.data) ? search.data : hojeLocalISO()
  )
  // Edição: guarda só o id; o registro vem da lista do dia (deep link ?editar= incluso).
  const [editandoId, setEditandoId] = useState<string | null>(search.editar ?? null)
  const [importarOpen, setImportarOpen] = useState(search.aba === 'importar')
  const [ultimoLote, setUltimoLote] = useState<{ id: string; n: number } | null>(null)
  const desfazer = useDesfazerImportacao()

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

  const desfazerUltimo = async (): Promise<void> => {
    if (!ultimoLote) return
    try {
      const n = await desfazer.mutateAsync({ importacao_id: ultimoLote.id })
      toast.success(`${contar(n, 'lançamento removido', 'lançamentos removidos')}.`)
      setUltimoLote(null)
    } catch (e) {
      toast.error(
        `Não foi possível desfazer a importação.${e instanceof Error && e.message ? ` ${e.message}` : ''}`
      )
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Lançar produção"
        subtitle={
          mobile
            ? (scope.obra?.codigo ?? '')
            : 'Registre o executado do dia por serviço do orçamento.'
        }
        className={cn(mobile && 'px-4 py-2')}
        actions={
          !mobile ? (
            <div className="flex items-center gap-1.5">
              {ultimoLote ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void desfazerUltimo()}
                  disabled={desfazer.isPending}
                  title={`Remove do último lote importado: ${contar(ultimoLote.n, 'lançamento', 'lançamentos')}`}
                >
                  <Undo2 size={12} />{' '}
                  {desfazer.isPending ? 'Desfazendo…' : `Desfazer importação (${ultimoLote.n})`}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setImportarOpen(true)}>
                <FileUp size={12} /> Importar planilha
              </Button>
              {!bare ? (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Abre esta tela sem o menu, para usar no celular"
                  onClick={() => void navigate({ to: '/lancar' })}
                >
                  <Smartphone size={12} /> Modo campo
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <div
        className={cn(
          'border-b border-border bg-bg-panel flex items-center gap-1',
          mobile ? 'px-2' : 'px-5'
        )}
        role="tablist"
        aria-label="Forma de lançar"
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

      <ImportarProducaoDialog
        open={importarOpen}
        onOpenChange={setImportarOpen}
        obraId={obraId}
        onImportado={(id, n) => setUltimoLote(id ? { id, n } : null)}
      />
    </div>
  )
}
