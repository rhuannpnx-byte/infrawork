import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import {
  useEquipes,
  usePlanejamentos,
  usePlanejamentoAtivo,
  useBaseline
} from '@/features/planejamento/hooks'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { ProntidaoObra } from '@/features/gerencial/components/ProntidaoObra'

export function PlanejamentoIndex(): ReactNode {
  return (
    <RequireObra pageTitle="Planejamento">
      <PlanejamentoIndexInner />
    </RequireObra>
  )
}

function PlanejamentoIndexInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!

  const { data: equipes = [] } = useEquipes(obraId)
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const { data: baseline } = useBaseline(obraId)

  const tiposEquipe = equipes.reduce<Record<string, number>>((acc, e) => {
    acc[e.tipo] = (acc[e.tipo] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planejamento"
        subtitle="Cronograma, tempo-caminho, calendários e linha de base."
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <FaixaIndicadores rotulo="Resumo do planejamento">
          <Indicador
            rotulo={ativo && !ativo.is_baseline ? 'Plano em edição' : 'Plano'}
            tamanho="sm"
            valor={ativo?.nome ?? '—'}
            titulo={ativo?.nome}
            aoClicar={() => void navigate({ to: '/planejamento/cronograma' })}
          >
            <span>
              {ativo
                ? `início em ${fmtDataBR(ativo.data_referencia_inicio)} · ${ativo.is_baseline ? 'linha de base' : 'em edição'}`
                : 'crie o primeiro plano no cronograma'}
            </span>
          </Indicador>
          <Indicador
            rotulo={baseline?.provisoria ? 'Referência provisória' : 'Linha de base vigente'}
            tamanho="sm"
            tom={baseline && !baseline.provisoria ? 'neutro' : 'warn'}
            valor={baseline?.nome ?? 'Nenhuma'}
            titulo={baseline?.nome}
            aoClicar={() => void navigate({ to: '/planejamento/comparar' })}
          >
            <span>
              {baseline
                ? baseline.provisoria
                  ? 'sem vigente: replanejamento em andamento'
                  : `vigente desde ${fmtDataBR((baseline.vigente_em ?? baseline.updated_at).slice(0, 10))}`
                : 'o previsto fica vazio até um plano ser travado'}
            </span>
          </Indicador>
          <Indicador
            rotulo="Equipes"
            tamanho="sm"
            valor={equipes.length.toLocaleString('pt-BR')}
            aoClicar={() => void navigate({ to: '/planejamento/equipes' })}
          >
            <span>
              {Object.entries(tiposEquipe)
                .map(([t, n]) => `${n} ${t.toLowerCase()}`)
                .join(' · ') || 'nenhuma equipe cadastrada'}
            </span>
          </Indicador>
          <Indicador
            rotulo="Linhas de base"
            tamanho="sm"
            valor={planejamentos.filter((p) => p.is_baseline).length.toLocaleString('pt-BR')}
            unidade="de 20"
            aoClicar={() => void navigate({ to: '/planejamento/cronograma' })}
          >
            <span>
              {planejamentos.some((p) => !p.is_baseline)
                ? 'há um plano em edição'
                : 'nenhum plano em edição'}
            </span>
          </Indicador>
        </FaixaIndicadores>

        <ProntidaoObra obraId={obraId} />
      </div>
    </div>
  )
}
