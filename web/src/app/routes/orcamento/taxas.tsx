import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Power } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { ErroConsulta } from '@/components/ui/estado'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { useTaxas, useToggleAtivoTaxa, useTaxaVigente } from '@/features/orcamento/hooks/taxas'
import { NewTaxaRegimeDialog } from '@/features/orcamento/modals/NewTaxaRegimeDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import type { TaxaRegime } from '@/types/orcamento'

export function TaxasPage(): ReactNode {
  return (
    <RequireObra pageTitle="Taxas">
      <TaxasInner />
    </RequireObra>
  )
}

const colunaPerc = (
  chave: keyof TaxaRegime & string,
  rotulo: string
): ColumnDef<TaxaRegime, unknown> => ({
  accessorKey: chave,
  header: rotulo,
  cell: (info) => <span className="text-text-muted">{fmtPct2(info.getValue() as number)}</span>,
  meta: { label: rotulo, align: 'right' },
  size: 80
})

function TaxasInner(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!
  const { data: taxas = [], isLoading, error, refetch } = useTaxas(obraId)
  const { data: taxaVigente } = useTaxaVigente(obraId)
  const { data: plan } = usePlanOrc(obraId)
  const toggleAtivo = useToggleAtivoTaxa()
  const [openNew, setOpenNew] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  // Totais da obra para mostrar o lucro real no rodapé
  const totalRaizVenda = (plan?.tree ?? []).reduce((acc, n) => acc + n.venda_total_calc, 0)
  const totalRaizCusto = (plan?.tree ?? []).reduce((acc, n) => acc + n.custo_total_calc, 0)
  const taxa = Number(taxaVigente?.total_perc_calc ?? 0)
  const impostos = totalRaizVenda * taxa
  const lucro = totalRaizVenda - totalRaizCusto - impostos
  const margemLiquida = totalRaizVenda > 0 ? lucro / totalRaizVenda : null

  const columns = useMemo<ColumnDef<TaxaRegime, unknown>[]>(
    () => [
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Nome' }
      },
      colunaPerc('iss_perc', 'ISS'),
      colunaPerc('pis_perc', 'PIS'),
      colunaPerc('cofins_perc', 'COFINS'),
      colunaPerc('csll_perc', 'CSLL'),
      colunaPerc('irpj_perc', 'IRPJ'),
      colunaPerc('cprb_perc', 'CPRB'),
      colunaPerc('outros_perc', 'Outros'),
      {
        accessorKey: 'total_perc_calc',
        header: 'Total',
        cell: (info) => (
          <span className="font-semibold text-text">{fmtPct2(info.getValue() as number)}</span>
        ),
        meta: { label: 'Total', align: 'right' },
        size: 90
      },
      {
        accessorKey: 'vigencia_inicio',
        header: 'Vigência',
        cell: (info) => {
          const v = info.getValue() as string | null
          return <span className="text-text-muted">{v ? formatDate(v) : '—'}</span>
        },
        meta: { label: 'Vigência' },
        size: 110
      },
      {
        accessorKey: 'ativo',
        header: 'Situação',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">Ativa</Badge>
          ) : (
            <Badge>Inativa</Badge>
          ),
        meta: { label: 'Situação' },
        size: 90
      },
      {
        id: 'acoes',
        header: '',
        size: 60,
        enableSorting: false,
        cell: ({ row }) =>
          podeEditar ? (
            <div className="flex items-center justify-end">
              <IconButton
                size="sm"
                variant="ghost"
                disabled={toggleAtivo.isPending}
                onClick={() =>
                  toggleAtivo.mutate({
                    id: row.original.id,
                    ativo: !row.original.ativo,
                    obra_id: obraId
                  })
                }
                aria-label={`${row.original.ativo ? 'Desativar' : 'Reativar'} a taxa ${row.original.nome}`}
                title={row.original.ativo ? 'Desativar' : 'Reativar'}
              >
                <Power size={12} aria-hidden />
              </IconButton>
            </div>
          ) : null,
        meta: { label: 'Ações' }
      }
    ],
    [toggleAtivo, podeEditar, obraId]
  )

  const botaoNovo = podeEditar ? (
    <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
      <Plus size={12} aria-hidden /> Nova taxa
    </Button>
  ) : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Taxas"
        subtitle="Impostos sobre a receita, descontados no cálculo do lucro"
        actions={botaoNovo}
      />
      {error ? (
        <div className="px-5 pt-3">
          <ErroConsulta erro={error} oQue="as taxas" aoTentar={() => void refetch()} compacto />
        </div>
      ) : null}
      {error && taxas.length === 0 ? null : taxas.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="percent"
            title="Nenhuma taxa cadastrada"
            description={
              podeEditar
                ? 'Cadastre a taxa com os impostos da obra (ISS, PIS, COFINS, CSLL, IRPJ, CPRB e outros) para o lucro sair já descontado.'
                : 'Esta obra ainda não tem taxa de impostos cadastrada. Sem ela, o lucro aparece sem desconto de impostos.'
            }
            action={botaoNovo}
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Taxas"
          data={taxas}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar taxa…"
          emptyMessage="Nenhuma taxa encontrada"
          emptyDescription="Confira a busca ou cadastre uma nova taxa."
        />
      )}

      {/* Rodapé: aplica a taxa em vigor sobre a venda total da obra para mostrar o lucro real */}
      {taxas.length > 0 ? (
        <FaixaIndicadores
          rotulo="Resultado com a taxa em vigor"
          className="shrink-0 rounded-none border-x-0 border-b-0"
        >
          <Indicador
            rotulo="Taxa em vigor"
            valor={taxaVigente ? fmtPct2(taxa) : '—'}
            tamanho="sm"
            tom={taxaVigente ? 'neutro' : 'warn'}
          >
            <span>{taxaVigente ? taxaVigente.nome : 'Nenhuma taxa ativa'}</span>
          </Indicador>
          <Indicador
            rotulo="Venda"
            valor={fmtBRL(totalRaizVenda)}
            tamanho="sm"
            carregando={!plan}
          />
          <Indicador
            rotulo="Custo"
            valor={fmtBRL(totalRaizCusto)}
            tamanho="sm"
            carregando={!plan}
          />
          <Indicador rotulo="Impostos" valor={fmtBRL(impostos)} tamanho="sm" carregando={!plan} />
          <Indicador
            rotulo="Lucro"
            valor={fmtBRL(lucro)}
            tamanho="sm"
            carregando={!plan}
            tom={lucro < 0 ? 'danger' : lucro > 0 ? 'success' : 'neutro'}
          />
          <Indicador
            rotulo="Margem líquida"
            valor={margemLiquida !== null ? fmtPct2(margemLiquida) : '—'}
            tamanho="sm"
            carregando={!plan}
            tom={
              margemLiquida === null
                ? 'neutro'
                : margemLiquida < 0
                  ? 'danger'
                  : margemLiquida < 0.1
                    ? 'warn'
                    : 'success'
            }
          />
        </FaixaIndicadores>
      ) : null}

      <NewTaxaRegimeDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
    </div>
  )
}
