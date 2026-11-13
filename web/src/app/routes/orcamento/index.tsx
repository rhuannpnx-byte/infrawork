import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Briefcase } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { ErroConsulta } from '@/components/ui/estado'
import { Secao } from '@/components/ui/secao'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useUIStore } from '@/stores/ui-store'
import { useRecursos } from '@/features/orcamento/hooks/recursos'
import { useServicos } from '@/features/orcamento/hooks/servicos'
import { useCpus } from '@/features/orcamento/hooks/cpus'
import { useTaxas } from '@/features/orcamento/hooks/taxas'
import { contar } from '@/lib/rotulos'

export function OrcamentoIndex(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const openModal = useUIStore((s) => s.openModal)

  const obraId = scope.obraId
  const recursosQ = useRecursos(obraId)
  const servicosQ = useServicos(obraId)
  const cpusQ = useCpus(obraId)
  const taxasQ = useTaxas(obraId)
  const recursos = recursosQ.data ?? []
  const servicos = servicosQ.data ?? []
  const cpus = cpusQ.data ?? []
  const taxas = taxasQ.data ?? []

  if (!obraId) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Orçamento" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="briefcase"
            title="Selecione uma obra"
            description="O orçamento é feito por obra: recursos, composições, serviços, planilha orçamentária, aditivos e reajustes pertencem a uma obra só."
            action={
              <Button variant="default" size="sm" onClick={() => openModal('projectSwitcher')}>
                <Briefcase size={12} aria-hidden /> Selecionar obra
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const consultas = [recursosQ, servicosQ, cpusQ, taxasQ]
  const comErro = consultas.find((q) => q.error)
  const contagem = (q: { error: unknown }, n: number): string =>
    q.error ? '—' : n.toLocaleString('pt-BR')
  const servicosFolha = servicos.filter((s) => s.unidade !== null).length
  const servicosAgr = servicos.length - servicosFolha

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Orçamento" subtitle="Cadastros desta obra, sem compartilhar com outras" />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {comErro ? (
          <ErroConsulta
            erro={comErro.error}
            oQue="os cadastros do orçamento"
            aoTentar={() => consultas.forEach((q) => (q.error ? void q.refetch() : undefined))}
            compacto
          />
        ) : null}
        <FaixaIndicadores rotulo="Cadastros do orçamento">
          <Indicador
            rotulo="Recursos"
            valor={contagem(recursosQ, recursos.length)}
            carregando={recursosQ.isLoading}
            aoClicar={() => navigate({ to: '/orcamento/recursos' })}
          >
            <span>Insumos cadastrados</span>
          </Indicador>
          <Indicador
            rotulo="Serviços"
            valor={contagem(servicosQ, servicos.length)}
            carregando={servicosQ.isLoading}
            aoClicar={() => navigate({ to: '/orcamento/servicos' })}
          >
            <span>
              {contar(servicosFolha, 'serviço', 'serviços')} em{' '}
              {contar(servicosAgr, 'grupo', 'grupos')}
            </span>
          </Indicador>
          <Indicador
            rotulo="Composições"
            valor={contagem(cpusQ, cpus.length)}
            carregando={cpusQ.isLoading}
            aoClicar={() => navigate({ to: '/orcamento/composicoes' })}
          >
            <span>Composições de custo em uso</span>
          </Indicador>
          <Indicador
            rotulo="Taxas"
            valor={contagem(taxasQ, taxas.length)}
            carregando={taxasQ.isLoading}
            aoClicar={() => navigate({ to: '/orcamento/taxas' })}
          >
            <span>Impostos sobre a receita</span>
          </Indicador>
        </FaixaIndicadores>

        <Secao
          titulo="Próximos passos"
          acoes={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate({ to: '/orcamento/obra/plan-orc' })}
            >
              Abrir a planilha orçamentária <ArrowRight size={12} aria-hidden />
            </Button>
          }
        >
          <ol className="max-w-[70ch] list-decimal space-y-1 pl-5 text-sm text-text-muted">
            <li>Cadastre os recursos (mão de obra, equipamentos e materiais).</li>
            <li>Monte a lista de serviços.</li>
            <li>Crie a composição de custo de cada serviço.</li>
            <li>
              Na planilha orçamentária, selecione as receitas e agrupe em serviço, o que vincula a
              composição.
            </li>
          </ol>
        </Secao>
      </div>
    </div>
  )
}
