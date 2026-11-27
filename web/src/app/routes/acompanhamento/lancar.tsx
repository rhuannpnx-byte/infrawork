import { type ReactNode } from 'react'
import { Navigate, useSearch } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { LancarProducao } from '@/features/acompanhamento/components/lancamento/LancarProducao'

interface BuscaLancar {
  aba?: string
  editar?: string
  data?: string
}

/**
 * Modo campo (/lancar): o lançamento em tela cheia, sem o menu, para usar no celular. No app completo o lançamento
 * é um modal da página Produção.
 */
export function AcompanhamentoLancarPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Lançar produção">
      <RequireObra pageTitle="Lançar produção">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const mobile = useIsMobile()
  const search = useSearch({ strict: false }) as BuscaLancar
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
      />
      <LancarProducao
        obraId={scope.obraId!}
        inicio={{ aba: search.aba, editarId: search.editar, data: search.data }}
        className="flex-1"
      />
    </div>
  )
}

/**
 * /acompanhamento/lancar: o endereço antigo da tela e o atalho "lançar produção" do resto do sistema (início,
 * busca, performance). Leva para a Produção com o modal aberto, repassando o dia, a aba ou o lançamento a editar.
 */
export function AcompanhamentoLancarAtalho(): ReactNode {
  const search = useSearch({ strict: false }) as BuscaLancar
  return (
    <Navigate to="/acompanhamento/producao" search={{ ...search, lancar: 1 } as never} replace />
  )
}
