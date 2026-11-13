import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { ErroConsulta } from '@/components/ui/estado'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { useIndireto, totalIndireto } from '@/features/orcamento/hooks/indireto'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import { ProntidaoObra } from '@/features/gerencial/components/ProntidaoObra'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'

export function ObraIndexPage(): ReactNode {
  return (
    <RequireObra pageTitle="Orçamento da obra">
      <ObraDashboard />
    </RequireObra>
  )
}

function ObraDashboard(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const obraId = scope.obraId!
  const planQ = usePlanOrc(obraId)
  const indiretoQ = useIndireto(obraId)
  const lucrQ = useLucratividade(obraId)
  const plan = planQ.data
  const indiretos = indiretoQ.data ?? []
  const lucr = lucrQ.data
  const consultas = [planQ, indiretoQ, lucrQ]
  const comErro = consultas.find((q) => q.error)

  const totalItens = plan?.flat.length ?? 0
  const totalReceitas = (plan?.flat ?? []).filter((i) => i.tipo === 'receita').length
  const indiretoTotal = totalIndireto(indiretos)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={scope.obra?.nome ?? 'Obra'}
        subtitle={`Código ${scope.obra?.codigo ?? '—'} · ${rotuloStatusObra(scope.obra?.status)}`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {comErro ? (
          <ErroConsulta
            erro={comErro.error}
            oQue="o resumo do orçamento"
            aoTentar={() => consultas.forEach((q) => (q.error ? void q.refetch() : undefined))}
            compacto
          />
        ) : null}
        <FaixaIndicadores rotulo="Resumo do orçamento">
          <Indicador
            rotulo="Venda total"
            tamanho="sm"
            valor={lucrQ.error ? '—' : fmtBRL(lucr?.venda_total ?? 0)}
            carregando={lucrQ.isLoading}
            aoClicar={() => void navigate({ to: '/orcamento/obra/lucratividade' })}
          >
            <span>soma das receitas da planilha</span>
          </Indicador>
          <Indicador
            rotulo="Lucratividade"
            tamanho="sm"
            tom={
              !lucr
                ? 'neutro'
                : lucr.lucro_liquido < 0
                  ? 'danger'
                  : (lucr.margem_perc ?? 0) < 0.1
                    ? 'warn'
                    : 'success'
            }
            valor={
              lucr?.margem_perc !== null && lucr?.margem_perc !== undefined
                ? fmtPct2(lucr.margem_perc)
                : '—'
            }
            carregando={lucrQ.isLoading}
            aoClicar={() => void navigate({ to: '/orcamento/obra/lucratividade' })}
          >
            <span>
              {lucr
                ? `${fmtBRL(lucr.lucro_liquido)}${lucr.lucro_liquido < 0 ? ' de prejuízo' : (lucr.margem_perc ?? 0) < 0.1 ? ' (margem baixa)' : ' de lucro'}`
                : lucrQ.error
                  ? 'não carregou'
                  : 'sem orçamento calculado'}
            </span>
          </Indicador>
          <Indicador
            rotulo="Indireto"
            tamanho="sm"
            valor={indiretoQ.error ? '—' : fmtBRL(indiretoTotal)}
            carregando={indiretoQ.isLoading}
            aoClicar={() => void navigate({ to: '/orcamento/obra/indireto' })}
          >
            <span>{contar(indiretos.length, 'lançamento', 'lançamentos')}</span>
          </Indicador>
          <Indicador
            rotulo="Itens da planilha"
            tamanho="sm"
            valor={planQ.error ? '—' : totalItens.toLocaleString('pt-BR')}
            carregando={planQ.isLoading}
            aoClicar={() => void navigate({ to: '/orcamento/obra/plan-orc' })}
          >
            <span>{contar(totalReceitas, 'receita', 'receitas')}</span>
          </Indicador>
        </FaixaIndicadores>

        <ProntidaoObra obraId={obraId} />
      </div>
    </div>
  )
}
