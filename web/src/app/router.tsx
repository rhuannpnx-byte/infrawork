import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect
} from '@tanstack/react-router'

import { TabRoot } from './TabRoot'
import { HomePage } from '@/app/routes/HomePage'
import { GerencialIndex } from '@/app/routes/gerencial'
import { EmpresasPage } from '@/app/routes/gerencial/empresas'
import { UsuariosPage } from '@/app/routes/gerencial/usuarios'
import { GerencialFrotaPage } from '@/app/routes/gerencial/frota'
import { ObrasPage } from '@/app/routes/gerencial/obras'
import { ObraDetailPage } from '@/app/routes/gerencial/obra-detail'
import { OrcamentoIndex } from '@/app/routes/orcamento'
import { RecursosPage } from '@/app/routes/orcamento/recursos'
import { ServicosPage } from '@/app/routes/orcamento/servicos'
import { ComposicoesPage } from '@/app/routes/orcamento/composicoes'
import { ComposicaoEditorPage, ComposicaoNovaPage } from '@/app/routes/orcamento/composicao-editor'
import { TaxasPage } from '@/app/routes/orcamento/taxas'
import { ObraIndexPage } from '@/app/routes/orcamento/obra-index'
import { PlanOrcPage } from '@/app/routes/orcamento/plan-orc'
import { IndiretoPage } from '@/app/routes/orcamento/indireto'
import { LucratividadePage } from '@/app/routes/orcamento/lucratividade'
import { AditivosPage } from '@/app/routes/orcamento/aditivos'
import { PlanilhaInicialPage } from '@/app/routes/orcamento/planilha-inicial'
import { ReajustesPage } from '@/app/routes/orcamento/reajustes'
import { PlanejamentoIndex } from '@/app/routes/planejamento'
import { PlanejamentoProgramacaoPage } from '@/app/routes/planejamento/programacao'
import { PlanejamentoCronogramaPage } from '@/app/routes/planejamento/cronograma'
import { PlanejamentoTempoCaminhoPage } from '@/app/routes/planejamento/tempo-caminho'
import { PlanejamentoRecursosPage } from '@/app/routes/planejamento/recursos'
import { PlanejamentoParametrizacaoPage } from '@/app/routes/planejamento/parametrizacao'
import { PlanejamentoCalendarioPage } from '@/app/routes/planejamento/calendario'
import { PlanejamentoEquipesPage } from '@/app/routes/planejamento/equipes'
import { PlanejamentoCurvaSPage } from '@/app/routes/planejamento/curva-s'
import { PlanejamentoCompararPage } from '@/app/routes/planejamento/comparar'
import { PlanejamentoRevisoesPage } from '@/app/routes/planejamento/revisoes'
import { PlanejamentoRevisaoDetalhePage } from '@/app/routes/planejamento/revisao-detalhe'
import { PlanejamentoTrechosPage } from '@/app/routes/planejamento/trechos'
import { AcompanhamentoIndex } from '@/app/routes/acompanhamento'
import { AcompanhamentoCalendarioPage } from '@/app/routes/acompanhamento/calendario'
import { AcompanhamentoProducaoPage } from '@/app/routes/acompanhamento/producao'
import { AcompanhamentoValorAgregadoPage } from '@/app/routes/acompanhamento/valor-agregado'
import { AcompanhamentoFotosPage } from '@/app/routes/acompanhamento/fotos'
import { AcompanhamentoPerformancePage } from '@/app/routes/acompanhamento/performance'
import { AcompanhamentoComparativoPage } from '@/app/routes/acompanhamento/comparativo'
import { AcompanhamentoAlertasPage } from '@/app/routes/acompanhamento/alertas'
import { AcompanhamentoLancarPage } from '@/app/routes/acompanhamento/lancar'
import { AcompanhamentoEquipesPage } from '@/app/routes/acompanhamento/equipes'
import { AcompanhamentoViagensPage } from '@/app/routes/acompanhamento/viagens'
import { AcompanhamentoTransportePage } from '@/app/routes/acompanhamento/transporte'

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
      // as dependências entre serviços são criadas no próprio cronograma (diálogo da dependência)
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
      component: PlanejamentoTempoCaminhoPage
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
      component: PlanejamentoProgramacaoPage
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
      component: PlanejamentoRecursosPage
    }),
    createRoute({
      getParentRoute: () => planejamentoLayout,
      path: 'comparar',
      component: PlanejamentoCompararPage
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
