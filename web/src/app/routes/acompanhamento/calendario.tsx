import { type ReactNode, useMemo } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useCurvaS, usePrevistoXRealizado } from '@/features/acompanhamento/hooks/comparativo'
import {
  CalendarioPrevExec,
  type ServicoInfo
} from '@/features/acompanhamento/components/calendario/CalendarioPrevExec'

export function AcompanhamentoCalendarioPage(): ReactNode {
  return (
    <RequireObra pageTitle="Calendário">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  // Janela ampla (~13 meses) para navegar pelos meses anteriores.
  const { data: curva = [], isLoading: loadingCurva } = useCurvaS(obraId, 400)
  const { data: itens = [], isLoading: loadingItens } = usePrevistoXRealizado(obraId)

  const servicos = useMemo<ServicoInfo[]>(
    () =>
      itens.map((it) => ({
        item_orcamentario_id: it.item_orcamentario_id,
        codigo: it.codigo,
        descricao: it.descricao,
        unidade: it.unidade
      })),
    [itens]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Calendário"
        subtitle={`${scope.obra?.nome ?? ''} · programação mensal — previsto × realizado por serviço`}
      />
      <div className="flex-1 overflow-auto p-5">
        <CalendarioPrevExec
          pontos={curva}
          servicos={servicos}
          obraNome={scope.obra?.nome ?? 'obra'}
          loading={loadingCurva || loadingItens}
        />
      </div>
    </div>
  )
}
