import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from '@tanstack/react-router'

import { AppShell } from '@/components/layout/AppShell'
import { Modals } from '@/components/modals/Modals'
import { HomePage } from '@/app/routes/HomePage'
import { GerencialIndex } from '@/app/routes/gerencial'
import { EmpresasPage } from '@/app/routes/gerencial/empresas'
import { UsuariosPage } from '@/app/routes/gerencial/usuarios'
import { ObrasPage } from '@/app/routes/gerencial/obras'
import { ObraDetailPage } from '@/app/routes/gerencial/obra-detail'
import { OrcamentoIndex } from '@/app/routes/orcamento'
import { RecursosPage } from '@/app/routes/orcamento/recursos'
import { ServicosPage } from '@/app/routes/orcamento/servicos'
import { CpusPage } from '@/app/routes/orcamento/cpus'
import { CpuEditorPage } from '@/app/routes/orcamento/cpu-editor'
import { TaxasPage } from '@/app/routes/orcamento/taxas'
import { ObraIndexPage } from '@/app/routes/orcamento/obra-index'
import { PlanOrcPage } from '@/app/routes/orcamento/plan-orc'
import { IndiretoPage } from '@/app/routes/orcamento/indireto'
import { LucratividadePage } from '@/app/routes/orcamento/lucratividade'
import { RevisoesPage } from '@/app/routes/orcamento/revisoes'
import { RevisaoDetailPage } from '@/app/routes/orcamento/revisao-detail'
import { PlanejamentoIndex } from '@/app/routes/planejamento'
import { PlanejamentoCronogramaPage } from '@/app/routes/planejamento/cronograma'
import { PlanejamentoCalendarioPage } from '@/app/routes/planejamento/calendario'
import { PlanejamentoEquipesPage } from '@/app/routes/planejamento/equipes'
import { PlanejamentoCurvaSPage } from '@/app/routes/planejamento/curva-s'
import { PlanejamentoCompararPage } from '@/app/routes/planejamento/comparar'
import { PlanejamentoRevisoesPage } from '@/app/routes/planejamento/revisoes'
import { PlanejamentoRevisaoDetalhePage } from '@/app/routes/planejamento/revisao-detalhe'
import { AcompanhamentoIndex } from '@/app/routes/acompanhamento'
import { AcompanhamentoVincularPage } from '@/app/routes/acompanhamento/vincular'
import { AcompanhamentoProducaoPage } from '@/app/routes/acompanhamento/producao'
import { AcompanhamentoFotosPage } from '@/app/routes/acompanhamento/fotos'
import { AcompanhamentoEquipesPage } from '@/app/routes/acompanhamento/equipes'
import { AcompanhamentoComparativoPage } from '@/app/routes/acompanhamento/comparativo'
import { AcompanhamentoAlertasPage } from '@/app/routes/acompanhamento/alertas'

/**
 * Router programático (não file-based). Cada módulo declara um layout pai com
 * `<Outlet />` e suas rotas filhas. Adicionar novo módulo é replicar o padrão.
 */

const rootRoute = createRootRoute({
  component: function RootLayout() {
    return (
      <>
        <AppShell>
          <Outlet />
        </AppShell>
        <Modals />
      </>
    )
  }
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage
})

// ─── Gerencial ───────────────────────────────────────────────────────────
const gerencialLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: 'gerencial',
  component: () => <Outlet />
})
const gerencialIndexRoute = createRoute({
  getParentRoute: () => gerencialLayout,
  path: '/',
  component: GerencialIndex
})
const gerencialEmpresasRoute = createRoute({
  getParentRoute: () => gerencialLayout,
  path: 'empresas',
  component: EmpresasPage
})
const gerencialUsuariosRoute = createRoute({
  getParentRoute: () => gerencialLayout,
  path: 'usuarios',
  component: UsuariosPage
})
const gerencialObrasListRoute = createRoute({
  getParentRoute: () => gerencialLayout,
  path: 'obras',
  component: ObrasPage
})
const gerencialObraDetailRoute = createRoute({
  getParentRoute: () => gerencialLayout,
  path: 'obras/$id',
  component: ObraDetailPage
})
const gerencialTree = gerencialLayout.addChildren([
  gerencialIndexRoute,
  gerencialEmpresasRoute,
  gerencialUsuariosRoute,
  gerencialObrasListRoute,
  gerencialObraDetailRoute
])

// ─── Orçamento ───────────────────────────────────────────────────────────
const orcamentoLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: 'orcamento',
  component: () => <Outlet />
})
const orcamentoIndexRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: '/',
  component: OrcamentoIndex
})
const orcamentoRecursosRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'recursos',
  component: RecursosPage
})
const orcamentoServicosRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'servicos',
  component: ServicosPage
})
const orcamentoCpusRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'cpus',
  component: CpusPage
})
const orcamentoCpuEditorRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'cpus/$id',
  component: CpuEditorPage
})
const orcamentoTaxasRoute = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'taxas',
  component: TaxasPage
})
// Sub-rotas obra-scoped (com RequireObra)
const orcamentoObraLayout = createRoute({
  getParentRoute: () => orcamentoLayout,
  path: 'obra',
  component: () => <Outlet />
})
const orcamentoObraIndexRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: '/',
  component: ObraIndexPage
})
const orcamentoPlanOrcRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: 'plan-orc',
  component: PlanOrcPage
})
const orcamentoIndiretoRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: 'indireto',
  component: IndiretoPage
})
const orcamentoLucratividadeRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: 'lucratividade',
  component: LucratividadePage
})
const orcamentoRevisoesRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: 'revisoes',
  component: RevisoesPage
})
const orcamentoRevisaoDetailRoute = createRoute({
  getParentRoute: () => orcamentoObraLayout,
  path: 'revisoes/$id',
  component: RevisaoDetailPage
})
const orcamentoObraTree = orcamentoObraLayout.addChildren([
  orcamentoObraIndexRoute,
  orcamentoPlanOrcRoute,
  orcamentoIndiretoRoute,
  orcamentoLucratividadeRoute,
  orcamentoRevisoesRoute,
  orcamentoRevisaoDetailRoute
])

const orcamentoTree = orcamentoLayout.addChildren([
  orcamentoIndexRoute,
  orcamentoRecursosRoute,
  orcamentoServicosRoute,
  orcamentoCpusRoute,
  orcamentoCpuEditorRoute,
  orcamentoTaxasRoute,
  orcamentoObraTree
])

// ─── Planejamento ────────────────────────────────────────────────────────
const planejamentoLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: 'planejamento',
  component: () => <Outlet />
})
const planejamentoIndexRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: '/',
  component: PlanejamentoIndex
})
const planejamentoCronogramaRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'cronograma',
  component: PlanejamentoCronogramaPage
})
const planejamentoCalendarioRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'calendario',
  component: PlanejamentoCalendarioPage
})
const planejamentoEquipesRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'equipes',
  component: PlanejamentoEquipesPage
})
const planejamentoCurvaSRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'curva-s',
  component: PlanejamentoCurvaSPage
})
const planejamentoCompararRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'comparar',
  component: PlanejamentoCompararPage
})
const planejamentoRevisoesRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'revisoes',
  component: PlanejamentoRevisoesPage
})
const planejamentoRevisaoDetalheRoute = createRoute({
  getParentRoute: () => planejamentoLayout,
  path: 'revisoes/$id',
  component: PlanejamentoRevisaoDetalhePage
})
const planejamentoTree = planejamentoLayout.addChildren([
  planejamentoIndexRoute,
  planejamentoCronogramaRoute,
  planejamentoCalendarioRoute,
  planejamentoEquipesRoute,
  planejamentoCurvaSRoute,
  planejamentoCompararRoute,
  planejamentoRevisoesRoute,
  planejamentoRevisaoDetalheRoute
])

// ─── Acompanhamento ──────────────────────────────────────────────────────
const acompanhamentoLayout = createRoute({
  getParentRoute: () => rootRoute,
  path: 'acompanhamento',
  component: () => <Outlet />
})
const acompanhamentoIndexRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: '/',
  component: AcompanhamentoIndex
})
const acompanhamentoVincularRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'vincular',
  component: AcompanhamentoVincularPage
})
const acompanhamentoProducaoRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'producao',
  component: AcompanhamentoProducaoPage
})
const acompanhamentoFotosRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'fotos',
  component: AcompanhamentoFotosPage
})
const acompanhamentoEquipesRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'equipes',
  component: AcompanhamentoEquipesPage
})
const acompanhamentoComparativoRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'comparativo',
  component: AcompanhamentoComparativoPage
})
const acompanhamentoAlertasRoute = createRoute({
  getParentRoute: () => acompanhamentoLayout,
  path: 'alertas',
  component: AcompanhamentoAlertasPage
})
const acompanhamentoTree = acompanhamentoLayout.addChildren([
  acompanhamentoIndexRoute,
  acompanhamentoVincularRoute,
  acompanhamentoProducaoRoute,
  acompanhamentoFotosRoute,
  acompanhamentoEquipesRoute,
  acompanhamentoComparativoRoute,
  acompanhamentoAlertasRoute
])

const routeTree = rootRoute.addChildren([indexRoute, gerencialTree, orcamentoTree, planejamentoTree, acompanhamentoTree])

// HashHistory: necessario em producao (Electron carrega via file://, onde
// browser history nao consegue resolver `/` — pathname vira o caminho do
// arquivo no disco e cai sempre em Not Found).
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  history: createHashHistory()
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
