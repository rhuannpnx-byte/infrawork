import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from '@tanstack/react-router'

import { TabRoot } from './TabRoot'
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
import { RevisoesCompararPage } from '@/app/routes/orcamento/revisoes-comparar'
import { PlanejamentoIndex } from '@/app/routes/planejamento'
import { PlanejamentoCronogramaPage } from '@/app/routes/planejamento/cronograma'
import { PlanejamentoCalendarioPage } from '@/app/routes/planejamento/calendario'
import { PlanejamentoTrechosPage } from '@/app/routes/planejamento/trechos'
import { PlanejamentoEquipesPage } from '@/app/routes/planejamento/equipes'
import { PlanejamentoCurvaSPage } from '@/app/routes/planejamento/curva-s'
import { PlanejamentoCompararPage } from '@/app/routes/planejamento/comparar'
import { PlanejamentoMarchaTempoPage } from '@/app/routes/planejamento/marcha-tempo'
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
 * Router por aba (keep-alive). Cada aba aberta tem sua própria instância de
 * router com history em memória; por isso a árvore de rotas é construída por
 * uma FÁBRICA (`buildRouteTree`) — compartilhar o mesmo objeto de árvore entre
 * vários routers cruzaria o estado de match/preload entre eles.
 *
 * O chrome (TitleBar, TabBar, rail, sidebar) vive FORA dos routers; o root de
 * cada aba renderiza apenas o conteúdo (`<Outlet/>`), isolado por ErrorBoundary.
 */

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- árvore de rotas do TanStack tem tipo derivado complexo
function buildRouteTree() {
  const rootRoute = createRootRoute({ component: TabRoot })

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
  const gerencialTree = gerencialLayout.addChildren([
    createRoute({ getParentRoute: () => gerencialLayout, path: '/', component: GerencialIndex }),
    createRoute({
      getParentRoute: () => gerencialLayout,
      path: 'empresas',
      component: EmpresasPage
    }),
    createRoute({
      getParentRoute: () => gerencialLayout,
      path: 'usuarios',
      component: UsuariosPage
    }),
    createRoute({ getParentRoute: () => gerencialLayout, path: 'obras', component: ObrasPage }),
    createRoute({
      getParentRoute: () => gerencialLayout,
      path: 'obras/$id',
      component: ObraDetailPage
    })
  ])

  // ─── Orçamento ───────────────────────────────────────────────────────────
  const orcamentoLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: 'orcamento',
    component: () => <Outlet />
  })
  const orcamentoObraLayout = createRoute({
    getParentRoute: () => orcamentoLayout,
    path: 'obra',
    component: () => <Outlet />
  })
  const orcamentoObraTree = orcamentoObraLayout.addChildren([
    createRoute({ getParentRoute: () => orcamentoObraLayout, path: '/', component: ObraIndexPage }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'plan-orc',
      component: PlanOrcPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'indireto',
      component: IndiretoPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'lucratividade',
      component: LucratividadePage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'revisoes',
      component: RevisoesPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'revisoes/comparar',
      component: RevisoesCompararPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'revisoes/$id',
      component: RevisaoDetailPage
    })
  ])
  const orcamentoTree = orcamentoLayout.addChildren([
    createRoute({ getParentRoute: () => orcamentoLayout, path: '/', component: OrcamentoIndex }),
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'recursos',
      component: RecursosPage
    }),
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'servicos',
      component: ServicosPage
    }),
    createRoute({ getParentRoute: () => orcamentoLayout, path: 'cpus', component: CpusPage }),
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'cpus/$id',
      component: CpuEditorPage
    }),
    createRoute({ getParentRoute: () => orcamentoLayout, path: 'taxas', component: TaxasPage }),
    orcamentoObraTree
  ])

  // ─── Planejamento ──────────────────────────────────────────────────────────
  const planejamentoLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: 'planejamento',
    component: () => <Outlet />
  })
  const planejamentoTree = planejamentoLayout.addChildren([
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: '/',
      component: PlanejamentoIndex
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'cronograma',
      component: PlanejamentoCronogramaPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'calendario',
      component: PlanejamentoCalendarioPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'trechos',
      component: PlanejamentoTrechosPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'equipes',
      component: PlanejamentoEquipesPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'curva-s',
      component: PlanejamentoCurvaSPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'comparar',
      component: PlanejamentoCompararPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'marcha-tempo',
      component: PlanejamentoMarchaTempoPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'revisoes',
      component: PlanejamentoRevisoesPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'revisoes/$id',
      component: PlanejamentoRevisaoDetalhePage
    })
  ])

  // ─── Acompanhamento ────────────────────────────────────────────────────────
  const acompanhamentoLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: 'acompanhamento',
    component: () => <Outlet />
  })
  const acompanhamentoTree = acompanhamentoLayout.addChildren([
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: '/',
      component: AcompanhamentoIndex
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'vincular',
      component: AcompanhamentoVincularPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'producao',
      component: AcompanhamentoProducaoPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'fotos',
      component: AcompanhamentoFotosPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'equipes',
      component: AcompanhamentoEquipesPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'comparativo',
      component: AcompanhamentoComparativoPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'alertas',
      component: AcompanhamentoAlertasPage
    })
  ])

  return rootRoute.addChildren([
    indexRoute,
    gerencialTree,
    orcamentoTree,
    planejamentoTree,
    acompanhamentoTree
  ])
}

/**
 * Cria uma instância de router (uma por aba) com history em memória, semeada
 * na localização inicial da aba.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- o tipo do router é a base do AppRouter (anotar criaria ciclo)
export function buildTabRouter(initialPath: string) {
  return createRouter({
    routeTree: buildRouteTree(),
    defaultPreload: 'intent',
    history: createMemoryHistory({ initialEntries: [initialPath || '/'] })
  })
}

export type AppRouter = ReturnType<typeof buildTabRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
