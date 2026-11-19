/**
 * Gaveta do escopo: ao lado do Gantt, quanto da quantidade orçada de cada serviço já está em tarefas do plano e
 * quanto falta distribuir. Acompanha a edição (lê as tarefas da própria tela), sem precisar somar à mão.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/IconButton'
import { Segmentado } from '@/components/ui/segmentado'
import { BarraAvanco } from '@/components/ui/indicador'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import { useItensSincronizaveis } from '@/features/planejamento/hooks/tarefas'
import type { PlanoEntrada } from '../motor/tipos'
import { fmtNum } from '../visoes/formato'
import { resumoDoEscopo, type EstadoEscopo, type LinhaEscopo } from '../visoes/escopo'

type Filtro = 'todos' | 'falta' | 'completo' | 'acima'

const TOM: Record<EstadoEscopo, 'accent' | 'success' | 'warn' | 'danger'> = {
  sem: 'warn',
  parcial: 'accent',
  completo: 'success',
  acima: 'danger'
}

function situacao(l: LinhaEscopo): { texto: string; classe: string } {
  const un = l.unidade ? ` ${l.unidade}` : ''
  if (l.estado === 'completo') return { texto: 'Completo', classe: 'text-success' }
  if (l.estado === 'acima')
    return { texto: `Passa ${fmtNum(-l.saldo, 'auto')}${un}`, classe: 'text-danger' }
  return {
    texto: `Falta ${fmtNum(l.saldo, 'auto')}${un}`,
    classe: l.estado === 'sem' ? 'text-warn' : 'text-text'
  }
}

export function EscopoPainel({
  obraId,
  entrada,
  onFechar,
  onAbrirTarefa
}: {
  obraId: string
  entrada: PlanoEntrada
  onFechar: () => void
  onAbrirTarefa: (id: string) => void
}): ReactNode {
  const itensQ = useItensSincronizaveis(entrada.plano.id, obraId)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set())

  const resumo = useMemo(
    () => resumoDoEscopo(itensQ.data ?? [], entrada.tarefas),
    [itensQ.data, entrada.tarefas]
  )
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return resumo.linhas.filter((l) => {
      if (filtro === 'falta' && l.estado !== 'sem' && l.estado !== 'parcial') return false
      if (filtro === 'completo' && l.estado !== 'completo') return false
      if (filtro === 'acima' && l.estado !== 'acima') return false
      return !q || `${l.codigo} ${l.descricao}`.toLowerCase().includes(q)
    })
  }, [resumo.linhas, filtro, busca])

  const alternar = (id: string): void => {
    const s = new Set(abertos)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setAbertos(s)
  }
  const falta = resumo.contagem.sem + resumo.contagem.parcial

  return (
    <aside
      aria-label="Escopo distribuído"
      className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-border bg-bg-panel"
    >
      {/* mesmo desenho da gaveta de serviços da planilha orçamentária */}
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <h2 className="flex-1 text-md font-semibold text-text">
          Escopo <span className="tabular font-normal text-text-muted">{resumo.linhas.length}</span>
        </h2>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="Recolher o escopo"
          title="Recolher o escopo"
          onClick={onFechar}
        >
          <ChevronsRight size={14} aria-hidden />
        </IconButton>
      </div>

      {itensQ.isLoading ? (
        <Carregando className="m-4" />
      ) : itensQ.error ? (
        <ErroConsulta
          className="m-3"
          erro={itensQ.error}
          oQue="os serviços do orçamento"
          aoTentar={() => void itensQ.refetch()}
          compacto
        />
      ) : resumo.linhas.length === 0 ? (
        <p className="p-4 text-xs text-text-muted">
          O orçamento ainda não tem serviços com quantidade para distribuir em tarefas.
        </p>
      ) : (
        <>
          <div className="space-y-2 border-b border-border px-3 py-2.5">
            {resumo.fracaoValor !== null ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular text-lg font-semibold text-text">
                    {fmtPct2(resumo.fracaoValor)}
                  </span>
                  <span className="text-2xs text-text-muted">
                    do valor orçado já está em tarefas
                  </span>
                </div>
                <BarraAvanco
                  valor={resumo.fracaoValor}
                  tom={resumo.fracaoValor >= 0.99995 ? 'success' : 'accent'}
                />
                <p className="tabular text-2xs text-text-muted">
                  {fmtBRL(resumo.valorDistribuido)} de {fmtBRL(resumo.valorOrcado)}
                </p>
              </>
            ) : null}
            <p className="text-xs text-text">
              {falta > 0 ? (
                <>
                  <strong>{contar(falta, 'serviço', 'serviços')}</strong> com quantidade a
                  distribuir
                </>
              ) : (
                <strong className="text-success">Todo o escopo está em tarefas</strong>
              )}
              {resumo.contagem.acima > 0 ? (
                <span className="text-danger"> · {resumo.contagem.acima} acima do orçado</span>
              ) : null}
            </p>
            {resumo.tarefasSemItem > 0 ? (
              <p className="text-2xs text-text-muted">
                {contar(resumo.tarefasSemItem, 'tarefa', 'tarefas')} sem serviço do orçamento não{' '}
                {resumo.tarefasSemItem === 1 ? 'entra' : 'entram'} nesta conta.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-b border-border px-3 py-2">
            <Segmentado
              rotulo="Mostrar serviços"
              tamanho="sm"
              valor={filtro}
              aoMudar={setFiltro}
              opcoes={[
                { valor: 'todos', rotulo: `Todos ${resumo.linhas.length}` },
                { valor: 'falta', rotulo: `Falta ${falta}` },
                { valor: 'completo', rotulo: `Completos ${resumo.contagem.completo}` },
                ...(resumo.contagem.acima > 0
                  ? [{ valor: 'acima' as const, rotulo: `Acima ${resumo.contagem.acima}` }]
                  : [])
              ]}
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar serviço"
              aria-label="Buscar serviço no escopo"
              className="h-7 text-xs"
            />
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {linhas.length === 0 ? (
              <li className="p-4 text-xs text-text-muted">Nenhum serviço neste filtro.</li>
            ) : null}
            {linhas.map((l) => {
              const aberto = abertos.has(l.id)
              const s = situacao(l)
              const un = l.unidade ? ` ${l.unidade}` : ''
              return (
                <li key={l.id} className="border-b border-border">
                  <button
                    type="button"
                    aria-expanded={aberto}
                    onClick={() => alternar(l.id)}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none"
                  >
                    <span className="flex items-start gap-1.5">
                      {aberto ? (
                        <ChevronDown
                          size={12}
                          className="mt-0.5 shrink-0 text-text-dim"
                          aria-hidden
                        />
                      ) : (
                        <ChevronRight
                          size={12}
                          className="mt-0.5 shrink-0 text-text-dim"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 text-xs text-text">
                        <span className="tabular text-text-dim">{l.codigo}</span> {l.descricao}
                      </span>
                    </span>
                    <BarraAvanco valor={l.fracao} tom={TOM[l.estado]} className="ml-[18px] h-1.5" />
                    <span className="ml-[18px] flex items-baseline justify-between gap-2 text-2xs">
                      <span className="tabular text-text-muted">
                        {fmtNum(l.distribuido, 'auto')} de {fmtNum(l.orcado, 'auto')}
                        {un}
                      </span>
                      <span className={cn('tabular font-semibold', s.classe)}>{s.texto}</span>
                    </span>
                  </button>
                  {aberto ? (
                    <ul className="bg-bg-elevated pb-1.5 pl-[30px] pr-3">
                      {l.tarefas.length === 0 ? (
                        <li className="py-1 text-2xs text-text-muted">
                          Nenhuma tarefa deste serviço no plano.
                        </li>
                      ) : null}
                      {l.tarefas.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => onAbrirTarefa(t.id)}
                            title="Abrir a tarefa"
                            className="flex w-full items-baseline justify-between gap-2 py-1 text-left text-2xs text-text-muted hover:text-accent focus-visible:text-accent focus-visible:outline-none"
                          >
                            <span className="min-w-0 truncate">
                              {t.nome}
                              {t.grupo ? <span className="text-text-dim"> · {t.grupo}</span> : null}
                            </span>
                            <span className="tabular shrink-0">
                              {fmtNum(t.quantidade, 'auto')}
                              {un}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </aside>
  )
}
