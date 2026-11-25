import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EstadoConsulta } from '@/components/ui/estado'
import { BarraAvanco, FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { formatNumber } from '@/lib/format'
import { contar, rotuloEstoqueStatus } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useAtivosEstoque } from '@/features/estoque/hooks/estoque'
import { AtivoDialog } from '@/features/estoque/components/AtivoDialog'
import { FichaAtivo } from '@/features/estoque/components/FichaAtivo'
import { LeituraDialog, MovimentoDialog } from '@/features/estoque/components/LancamentoDialogs'
import { MapaEstoque } from '@/features/estoque/components/MapaEstoque'
import {
  GRAVIDADE_STATUS,
  type AtivoEstoque,
  type StatusEstoque,
  type TipoAtivo
} from '@/features/estoque/tipos'

export function AcompanhamentoEstoquePage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Estoque">
      <RequireObra pageTitle="Estoque">
        <Estoque />
      </RequireObra>
    </RequireRole>
  )
}

const TOM_BARRA: Record<StatusEstoque, 'success' | 'warn' | 'danger' | 'accent'> = {
  normal: 'success',
  baixo: 'warn',
  zerado: 'danger',
  negativo: 'danger',
  sem_saldo: 'accent'
}
const VARIANTE: Record<StatusEstoque, 'success' | 'warn' | 'danger' | 'default'> = {
  normal: 'success',
  baixo: 'warn',
  zerado: 'danger',
  negativo: 'danger',
  sem_saldo: 'default'
}
const CABECALHO =
  'border-b border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

const qtd = (v: number, unidade: string): string =>
  `${formatNumber(v, Number.isInteger(v) ? 0 : 2)} ${unidade}`
const dia = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

type Dialogo =
  | { tipo: 'cadastro'; de: TipoAtivo; ativo: AtivoEstoque | null }
  | { tipo: 'movimento'; de: 'entrada' | 'saida'; ativo: AtivoEstoque }
  | { tipo: 'leitura'; ativo: AtivoEstoque }

/**
 * Controle de estoque da obra: o mapa com cada tanque e depósito e o status dele, a lista com o nível de cada um e
 * a ficha do ativo (extrato, entradas, saídas e leituras). Os totais são contagens e dias: não se soma litro com
 * tonelada.
 */
function Estoque(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeCadastrar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const podeLancar = podeCadastrar || role === 'apoio'

  const consulta = useAtivosEstoque(obraId)
  const todos = useMemo(() => consulta.data ?? [], [consulta.data])
  const [foraDeUso, setForaDeUso] = useState(false)
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [fichaAberta, setFichaAberta] = useState(false)
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)

  const ativos = useMemo(
    () =>
      todos
        .filter((a) => a.ativo || foraDeUso)
        .sort(
          (a, b) =>
            GRAVIDADE_STATUS[a.status] - GRAVIDADE_STATUS[b.status] ||
            a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })
        ),
    [todos, foraDeUso]
  )
  const emUso = todos.filter((a) => a.ativo)
  const selecionado = todos.find((a) => a.id === selecionadoId) ?? null
  // o diálogo trabalha com o ativo atualizado (o saldo muda a cada lançamento)
  const doDialogo = dialogo && 'ativo' in dialogo && dialogo.ativo ? dialogo.ativo.id : null
  const ativoDoDialogo = todos.find((a) => a.id === doDialogo) ?? null

  const baixos = emUso.filter((a) => a.status === 'baixo').length
  const zerados = emUso.filter((a) => a.status === 'zerado' || a.status === 'negativo').length
  const menorAutonomia = emUso
    .filter((a) => a.autonomia_dias != null)
    .sort((a, b) => a.autonomia_dias! - b.autonomia_dias!)[0]

  const abrir = (id: string): void => {
    setSelecionadoId(id)
    setFichaAberta(true)
  }
  const tanques = ativos.filter((a) => a.tipo === 'tanque')
  const depositos = ativos.filter((a) => a.tipo === 'deposito')
  const novo = podeCadastrar ? (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setDialogo({ tipo: 'cadastro', de: 'tanque', ativo: null })}>
        <Plus size={14} aria-hidden /> Novo tanque
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setDialogo({ tipo: 'cadastro', de: 'deposito', ativo: null })}
      >
        <Plus size={14} aria-hidden /> Novo depósito
      </Button>
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Estoque"
        subtitle="Tanques e depósitos da obra: quanto há em cada um e onde ficam."
        actions={novo}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        <FaixaIndicadores rotulo="Resumo do estoque">
          <Indicador
            rotulo="Em uso"
            tamanho="sm"
            carregando={consulta.isLoading}
            valor={emUso.length}
          >
            <span>
              {contar(emUso.filter((a) => a.tipo === 'tanque').length, 'tanque', 'tanques')} e{' '}
              {contar(emUso.filter((a) => a.tipo === 'deposito').length, 'depósito', 'depósitos')}
            </span>
          </Indicador>
          <Indicador
            rotulo="Abaixo do mínimo"
            tamanho="sm"
            carregando={consulta.isLoading}
            tom={baixos > 0 ? 'warn' : 'neutro'}
            valor={baixos}
          >
            <span>com saldo no mínimo ou abaixo</span>
          </Indicador>
          <Indicador
            rotulo="Zerados"
            tamanho="sm"
            carregando={consulta.isLoading}
            tom={zerados > 0 ? 'danger' : 'neutro'}
            valor={zerados}
          >
            <span>sem material ou com saldo negativo</span>
          </Indicador>
          <Indicador
            rotulo="Menor autonomia"
            tamanho="sm"
            carregando={consulta.isLoading}
            valor={
              menorAutonomia
                ? contar(Math.round(menorAutonomia.autonomia_dias!), 'dia', 'dias')
                : '—'
            }
          >
            <span>
              {menorAutonomia
                ? `${menorAutonomia.nome}, no ritmo das saídas de 14 dias`
                : 'sem saídas nos últimos 14 dias'}
            </span>
          </Indicador>
        </FaixaIndicadores>

        <EstadoConsulta
          consulta={consulta}
          oQue="o estoque"
          vazio={todos.length === 0}
          textoVazio={
            podeCadastrar
              ? 'Nenhum tanque ou depósito cadastrado. Cadastre o primeiro, marcando no mapa onde ele fica.'
              : 'Nenhum tanque ou depósito cadastrado nesta obra.'
          }
          acaoVazio={novo}
        >
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-h-[360px] overflow-hidden rounded border border-border">
              <MapaEstoque
                obraId={obraId}
                ativos={ativos}
                selecionadoId={fichaAberta ? selecionadoId : null}
                aoSelecionar={abrir}
              />
            </div>
            <div className="min-w-0 space-y-4">
              <Lista titulo="Tanques" ativos={tanques} aoAbrir={abrir} vazio="Nenhum tanque." />
              <Lista
                titulo="Depósitos"
                ativos={depositos}
                aoAbrir={abrir}
                vazio="Nenhum depósito."
              />
              {todos.some((a) => !a.ativo) ? (
                <label className="flex items-center gap-2 text-sm text-text-muted">
                  <input
                    type="checkbox"
                    checked={foraDeUso}
                    onChange={(e) => setForaDeUso(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Mostrar os que estão fora de uso
                </label>
              ) : null}
            </div>
          </div>
        </EstadoConsulta>
      </div>

      <FichaAtivo
        open={fichaAberta && !dialogo}
        onOpenChange={setFichaAberta}
        ativo={selecionado}
        obraNome={scope.obra?.nome ?? 'Obra'}
        podeLancar={podeLancar}
        podeCadastrar={podeCadastrar}
        aoEditar={() =>
          selecionado && setDialogo({ tipo: 'cadastro', de: selecionado.tipo, ativo: selecionado })
        }
        aoLancar={(de) => selecionado && setDialogo({ tipo: 'movimento', de, ativo: selecionado })}
        aoLer={() => selecionado && setDialogo({ tipo: 'leitura', ativo: selecionado })}
      />
      <AtivoDialog
        open={dialogo?.tipo === 'cadastro'}
        onOpenChange={(o) => !o && setDialogo(null)}
        obraId={obraId}
        tipo={dialogo?.tipo === 'cadastro' ? dialogo.de : 'tanque'}
        ativo={dialogo?.tipo === 'cadastro' ? (ativoDoDialogo ?? dialogo.ativo) : null}
      />
      {dialogo?.tipo === 'movimento' && ativoDoDialogo ? (
        <MovimentoDialog
          open
          onOpenChange={(o) => !o && setDialogo(null)}
          ativo={ativoDoDialogo}
          tipo={dialogo.de}
        />
      ) : null}
      {dialogo?.tipo === 'leitura' && ativoDoDialogo ? (
        <LeituraDialog open onOpenChange={(o) => !o && setDialogo(null)} ativo={ativoDoDialogo} />
      ) : null}
    </div>
  )
}

/** Tabela de ativos de um tipo, com a barra de nível na linha. A linha inteira abre a ficha. */
function Lista({
  titulo,
  ativos,
  aoAbrir,
  vazio
}: {
  titulo: string
  ativos: AtivoEstoque[]
  aoAbrir: (id: string) => void
  vazio: string
}): ReactNode {
  return (
    <section
      aria-label={titulo}
      className="overflow-hidden rounded border border-border bg-bg-panel"
    >
      <h2 className="px-4 py-2.5 text-lg font-semibold text-text">
        {titulo} <span className="text-sm font-normal text-text-muted">{ativos.length || ''}</span>
      </h2>
      {ativos.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-text-muted">{vazio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[520px] text-sm"
            data-testid={`estoque-lista-${titulo.toLowerCase()}`}
          >
            <thead>
              <tr className={CABECALHO}>
                <th className="px-4 py-2 text-left font-semibold">Nome</th>
                <th className="w-[34%] px-2 py-2 text-left font-semibold">Nível</th>
                <th className="px-2 py-2 text-right font-semibold">Autonomia</th>
                <th className="px-4 py-2 text-right font-semibold">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {ativos.map((a) => {
                const pct = a.nivel == null ? null : Math.round(a.nivel * 100)
                return (
                  <tr
                    key={a.id}
                    className={cn(
                      'border-b border-border last:border-b-0 hover:bg-bg-hover',
                      !a.ativo && 'opacity-60'
                    )}
                  >
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => aoAbrir(a.id)}
                        className="text-left font-medium text-text hover:text-accent hover:underline"
                      >
                        {a.nome}
                      </button>
                      <span className="block text-xs text-text-muted">{a.material}</span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <BarraAvanco
                          valor={a.nivel ?? 0}
                          marca={a.estoque_minimo > 0 ? a.estoque_minimo / a.capacidade : null}
                          tom={TOM_BARRA[a.status]}
                          className="flex-1"
                        />
                        <span className="w-10 text-right tabular text-text">
                          {pct == null ? '—' : `${pct}%`}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                        <span className="tabular">
                          {a.saldo == null
                            ? `capacidade de ${qtd(a.capacidade, a.unidade)}`
                            : `${qtd(a.saldo, a.unidade)} de ${qtd(a.capacidade, a.unidade)}`}
                        </span>
                        {a.status !== 'normal' ? (
                          <Badge variant={VARIANTE[a.status]}>
                            {rotuloEstoqueStatus(a.status)}
                          </Badge>
                        ) : null}
                        {!a.ativo ? <Badge variant="outline">Fora de uso</Badge> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular text-text-muted">
                      {a.autonomia_dias != null
                        ? contar(Math.round(a.autonomia_dias), 'dia', 'dias')
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular text-text-muted">
                      {a.leitura_momento ? dia(a.leitura_momento) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
