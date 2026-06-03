import { Outlet, useLocation } from '@tanstack/react-router'
import { type ReactNode } from 'react'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { getModuleByRoute } from '@/config/modules'

/**
 * Root de cada aba (dentro do `RouterProvider` da aba). Renderiza só o conteúdo
 * (`<Outlet/>`), isolado por ErrorBoundary com reset por rota — o chrome do app
 * vive fora dos routers. Em arquivo próprio para satisfazer o fast-refresh
 * (router.tsx exporta apenas funções/tipos, sem componentes).
 */
export function TabRoot(): ReactNode {
  const location = useLocation()
  const moduleKey = getModuleByRoute(location.pathname)?.key ?? 'home'
  return (
    <ErrorBoundary key={location.pathname} scope={moduleKey}>
      <Outlet />
    </ErrorBoundary>
  )
}
