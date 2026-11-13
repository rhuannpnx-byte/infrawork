import { AvisoSemLinhaDeBase } from '@/features/acompanhamento/components/AvisoSemLinhaDeBase'
import { type ReactNode, useMemo } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { ErroConsulta } from '@/components/ui/estado'
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
  const consultaCurva = useCurvaS(obraId, 400)
  const consultaItens = usePrevistoXRealizado(obraId)
  const { data: curva = [], isLoading: loadingCurva } = consultaCurva
  const { data: itens = [], isLoading: loadingItens } = consultaItens
  const erro = consultaCurva.error ?? consultaItens.error

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
      <PageHeader title="Calendário" subtitle="Previsto e realizado de cada serviço, dia a dia" />
      <AvisoSemLinhaDeBase obraId={obraId} />
      <div className="flex-1 overflow-auto p-5">
        {erro ? (
          <ErroConsulta
            erro={erro}
            oQue="a programação"
            aoTentar={() => {
              void consultaCurva.refetch()
              void consultaItens.refetch()
            }}
          />
        ) : (
          <CalendarioPrevExec
            pontos={curva}
            servicos={servicos}
            obraNome={scope.obra?.nome ?? 'obra'}
            loading={loadingCurva || loadingItens}
          />
        )}
      </div>
    </div>
  )
}
