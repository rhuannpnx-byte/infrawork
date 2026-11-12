import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect
} from '@tanstack/react-router'

import { TabRoot } from './TabRoot'
import { HomePage } from '@/app/routes/HomePage'

// cada tela vira um pedaço do bundle, baixado quando a rota abre pela primeira vez
const GerencialIndex = lazyRouteComponent(() => import('@/app/routes/gerencial'), 'GerencialIndex')
const EmpresasPage = lazyRouteComponent(
  () => import('@/app/routes/gerencial/empresas'),
  'EmpresasPage'
)
const UsuariosPage = lazyRouteComponent(
  () => import('@/app/routes/gerencial/usuarios'),
  'UsuariosPage'
)
const GerencialFrotaPage = lazyRouteComponent(
  () => import('@/app/routes/gerencial/frota'),
  'GerencialFrotaPage'
)
const ObrasPage = lazyRouteComponent(() => import('@/app/routes/gerencial/obras'), 'ObrasPage')
const ObraDetailPage = lazyRouteComponent(
  () => import('@/app/routes/gerencial/obra-detail'),
  'ObraDetailPage'
)
const OrcamentoIndex = lazyRouteComponent(() => import('@/app/routes/orcamento'), 'OrcamentoIndex')
const RecursosPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/recursos'),
  'RecursosPage'
)
const ServicosPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/servicos'),
  'ServicosPage'
)
const ComposicoesPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/composicoes'),
  'ComposicoesPage'
)
const ComposicaoEditorPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/composicao-editor'),
  'ComposicaoEditorPage'
)
const ComposicaoNovaPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/composicao-editor'),
  'ComposicaoNovaPage'
)
const TaxasPage = lazyRouteComponent(() => import('@/app/routes/orcamento/taxas'), 'TaxasPage')
const ObraIndexPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/obra-index'),
  'ObraIndexPage'
)
const PlanOrcPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/plan-orc'),
  'PlanOrcPage'
)
const IndiretoPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/indireto'),
  'IndiretoPage'
)
const LucratividadePage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/lucratividade'),
  'LucratividadePage'
)
const AditivosPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/aditivos'),
  'AditivosPage'
)
const PlanilhaInicialPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/planilha-inicial'),
  'PlanilhaInicialPage'
)
const ReajustesPage = lazyRouteComponent(
  () => import('@/app/routes/orcamento/reajustes'),
  'ReajustesPage'
)
const PlanejamentoIndex = lazyRouteComponent(
  () => import('@/app/routes/planejamento'),
  'PlanejamentoIndex'
)
const PlanejamentoCronogramaPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/cronograma'),
  'PlanejamentoCronogramaPage'
)
const PlanejamentoTempoCaminhoPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/tempo-caminho'),
  'PlanejamentoTempoCaminhoPage'
)
const PlanejamentoRecursosPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/recursos'),
  'PlanejamentoRecursosPage'
)
const PlanejamentoParametrizacaoPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/parametrizacao'),
  'PlanejamentoParametrizacaoPage'
)
const PlanejamentoCalendarioPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/calendario'),
  'PlanejamentoCalendarioPage'
)
const PlanejamentoEquipesPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/equipes'),
  'PlanejamentoEquipesPage'
)
const PlanejamentoCurvaSPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/curva-s'),
  'PlanejamentoCurvaSPage'
)
const PlanejamentoCompararPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/comparar'),
  'PlanejamentoCompararPage'
)
const PlanejamentoTrechosPage = lazyRouteComponent(
  () => import('@/app/routes/planejamento/trechos'),
  'PlanejamentoTrechosPage'
)
const AcompanhamentoIndex = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento'),
  'AcompanhamentoIndex'
)
const AcompanhamentoCalendarioPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/calendario'),
  'AcompanhamentoCalendarioPage'
)
const AcompanhamentoProducaoPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/producao'),
  'AcompanhamentoProducaoPage'
)
const AcompanhamentoValorAgregadoPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/valor-agregado'),
  'AcompanhamentoValorAgregadoPage'
)
const AcompanhamentoFotosPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/fotos'),
  'AcompanhamentoFotosPage'
)
const AcompanhamentoPerformancePage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/performance'),
  'AcompanhamentoPerformancePage'
)
const AcompanhamentoComparativoPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/comparativo'),
  'AcompanhamentoComparativoPage'
)
const AcompanhamentoAlertasPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/alertas'),
  'AcompanhamentoAlertasPage'
)
const AcompanhamentoLancarPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/lancar'),
  'AcompanhamentoLancarPage'
)
const AcompanhamentoEquipesPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/equipes'),
  'AcompanhamentoEquipesPage'
)
const AcompanhamentoViagensPage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/viagens'),
  'AcompanhamentoViagensPage'
)
const AcompanhamentoTransportePage = lazyRouteComponent(
  () => import('@/app/routes/acompanhamento/transporte'),
  'AcompanhamentoTransportePage'
)

/**
 * Router por aba (keep-alive). Cada aba aberta tem sua própria instância de
 * router com history em memória; por isso a árvore de rotas é construída por
 * uma FÁBRICA (`buildRouteTree`) — compartilhar o mesmo objeto de árvore entre
 * vários routers cruzaria o estado de match/preload entre eles.
 *
 * O chrome (TitleBar, TabBar, rail, sidebar) vive FORA dos routers; o root de
 * cada aba renderiza apenas o conteúdo (`<Outlet/>`), isolado por ErrorBoundary.
 *
 * Na web, a localização da aba ativa é espelhada na URL do browser por
 * `app/url-sync.ts` (deep link, F5, Back/Forward).
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
      path: 'frota',
      component: GerencialFrotaPage
    }),
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
      path: 'aditivos',
      component: AditivosPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'planilha-inicial',
      component: PlanilhaInicialPage
    }),
    createRoute({
      getParentRoute: () => orcamentoObraLayout,
      path: 'reajustes',
      component: ReajustesPage
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
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'composicoes',
      component: ComposicoesPage
    }),
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'composicoes/nova',
      component: ComposicaoNovaPage
    }),
    createRoute({
      getParentRoute: () => orcamentoLayout,
      path: 'composicoes/$id',
      component: ComposicaoEditorPage
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
  // endereços antigos (abas salvas, favoritos) redirecionam para a tela atual
  const planejamentoTree = planejamentoLayout.addChildren([
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'trechos',
      component: PlanejamentoTrechosPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'tempo-caminho',
      component: PlanejamentoTempoCaminhoPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'recursos',
      component: PlanejamentoRecursosPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'servicos',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/cronograma' })
      }
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'parametrizacao',
      component: PlanejamentoParametrizacaoPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'marcha-tempo',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/tempo-caminho' })
      }
    }),
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
      path: 'programacao',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/cronograma' })
      }
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'calendario',
      component: PlanejamentoCalendarioPage
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
      path: 'histograma',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/recursos' })
      }
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'comparar',
      component: PlanejamentoCompararPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'revisoes',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/cronograma' })
      }
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'revisoes/$id',
      beforeLoad: () => {
        throw redirect({ to: '/planejamento/cronograma' })
      }
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
      path: 'calendario',
      component: AcompanhamentoCalendarioPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'valor-agregado',
      component: AcompanhamentoValorAgregadoPage
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
      path: 'comparativo',
      component: AcompanhamentoComparativoPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'alertas',
      component: AcompanhamentoAlertasPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'performance',
      component: AcompanhamentoPerformancePage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'lancar',
      component: AcompanhamentoLancarPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'equipes',
      component: AcompanhamentoEquipesPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'viagens',
      component: AcompanhamentoViagensPage
    }),
    createRoute({
      getParentRoute: () => acompanhamentoLayout,
      path: 'transporte',
      component: AcompanhamentoTransportePage
    })
  ])

  // Rota "bare" (sem chrome) para lançar produção no celular — ver AppShell.
  const lancarBareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'lancar',
    component: AcompanhamentoLancarPage
  })

  return rootRoute.addChildren([
    indexRoute,
    gerencialTree,
    orcamentoTree,
    planejamentoTree,
    acompanhamentoTree,
    lancarBareRoute
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
