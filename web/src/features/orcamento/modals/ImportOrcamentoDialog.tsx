import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { downloadBlob, nomeComStamp } from '@/lib/files/download'
import { ImportTemplateDialog } from '@/components/import/ImportTemplateDialog'
import { Campo } from '@/components/ui/campo'
import { Select } from '@/components/ui/select'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import { usePlanOrc } from '../hooks/plan-orc'
import { useImportarOrcamento } from '../hooks/importacao'
import {
  ORCAMENTO_SPEC,
  exportarOrcamentoModelo,
  gerarModeloOrcamento,
  orcamentoToPayload,
  parseOrcamento,
  type OrcamentoLinha
} from '@/lib/xlsx/templates/orcamento'
import { fmtBRL, fmtPct2, fmtQtd } from '@/lib/money'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

interface Opcoes {
  existentes: 'pular' | 'atualizar'
}

const TIPO_LABEL: Record<OrcamentoLinha['tipo'], string> = {
  etapa: 'Índice',
  receita: 'Receita'
}

export function ImportOrcamentoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const scope = useCurrentScope()
  const empresa = useEmpresaAtual()
  const { data: planOrc } = usePlanOrc(obraId)
  const itens = planOrc?.flat ?? []
  const importar = useImportarOrcamento()

  return (
    <ImportTemplateDialog<OrcamentoLinha, Opcoes>
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar planilha orçamentária"
      entidadeLabel="itens"
      gerarModelo={() =>
        gerarModeloOrcamento({
          empresaNome: empresa?.nome ?? '',
          obraCodigo: scope.obra?.codigo ?? '',
          obraNome: scope.obra?.nome ?? ''
        })
      }
      nomeArquivoModelo={ORCAMENTO_SPEC.fileName}
      extraDownload={
        itens.length > 0 && planOrc
          ? {
              label: 'Baixar planilha atual',
              descricao:
                'A planilha da obra no formato do modelo (venda, serviços e rateios), para revisar no Excel e importar de novo',
              baixar: async () => {
                const { blob, truncadas, manuaisSemLinha } = exportarOrcamentoModelo(
                  {
                    empresaNome: empresa?.nome ?? '',
                    obraCodigo: scope.obra?.codigo ?? '',
                    obraNome: scope.obra?.nome ?? ''
                  },
                  planOrc.flat,
                  planOrc.servicos,
                  planOrc.alocacoes
                )
                downloadBlob(
                  await blob,
                  nomeComStamp(`orcamento-${scope.obra?.codigo ?? 'obra'}`, 'xlsx')
                )
                if (truncadas.length > 0)
                  toast.warning(
                    `Receitas rateadas em mais de 5 serviços. Só os 5 maiores foram exportados: ${truncadas.join(', ')}.`
                  )
                if (manuaisSemLinha.length > 0)
                  toast.warning(
                    `Serviços com quantidade manual e sem receita alocada. A quantidade não foi exportada: ${manuaisSemLinha.join(', ')}.`
                  )
              }
            }
          : undefined
      }
      parse={(wb) => parseOrcamento(wb, { itens })}
      previewColumns={[
        {
          key: 'codigo',
          header: 'Código',
          render: (r) => r.data.codigo,
          width: 90
        },
        { key: 'descricao', header: 'Descrição', render: (r) => r.data.descricao },
        {
          key: 'tipo',
          header: 'Tipo',
          render: (r) => <span className="text-text-muted">{TIPO_LABEL[r.data.tipo]}</span>,
          width: 80
        },
        {
          key: 'qtd',
          header: 'Quantidade',
          render: (r) =>
            r.data.quantidade != null
              ? `${fmtQtd(r.data.quantidade)} ${r.data.unidade ?? ''}`
              : '—',
          align: 'right',
          width: 110
        },
        {
          key: 'venda',
          header: 'Venda unitária',
          render: (r) => (r.data.venda_unitaria != null ? fmtBRL(r.data.venda_unitaria) : '—'),
          align: 'right',
          width: 120
        },
        {
          key: 'servicos',
          header: 'Serviços',
          render: (r) => {
            const ds = r.data.destinos
            if (ds.length === 0) return <span className="text-text-dim">—</span>
            return (
              <span className="flex flex-col leading-tight">
                {ds.map((d, i) => (
                  <span key={i} className="truncate">
                    {d.servico}
                    {ds.length > 1 || (r.data.fracoes[i] ?? 1) < 0.9999 ? (
                      <span className="tabular text-xs text-text-muted">
                        {' '}
                        {r.data.fracoes[i] === null
                          ? 'proporcional à venda'
                          : fmtPct2(r.data.fracoes[i] ?? 0)}
                      </span>
                    ) : null}
                  </span>
                ))}
                {r.data.qtd_servico != null ? (
                  <span className="text-xs text-text-muted">
                    Quantidade manual do serviço: {fmtQtd(r.data.qtd_servico)}{' '}
                    {r.data.unid_servico ?? ''}
                  </span>
                ) : r.data.compoe_qtd ? (
                  <span className="text-xs text-text-muted">Compõe a quantidade do serviço</span>
                ) : null}
              </span>
            )
          },
          width: 260
        }
      ]}
      opcoes={{
        inicial: { existentes: 'pular' },
        render: (v, set) => (
          <Campo rotulo="Códigos que já existem na planilha" className="max-w-md">
            <Select
              value={v.existentes}
              onChange={(e) => set({ ...v, existentes: e.target.value as 'pular' | 'atualizar' })}
            >
              <option value="pular">Ignorar (manter como está)</option>
              <option value="atualizar">Atualizar descrição, quantidade, preço e serviços</option>
            </Select>
          </Campo>
        )
      }}
      acaoEfetiva={(acao, opt) =>
        acao === 'atualizar' && opt.existentes === 'pular' ? 'pular' : acao
      }
      aplicar={(rows, opt) =>
        importar.mutateAsync({
          obra_id: obraId,
          ...orcamentoToPayload(rows),
          opcoes: { existentes: opt.existentes, tudo_ou_nada: true }
        })
      }
      resultadoMetrics={(r) => [
        { label: 'Índices criados', value: r.stats.etapas_criadas ?? 0 },
        { label: 'Receitas criadas', value: r.stats.receitas_criadas ?? 0 },
        { label: 'Serviços criados', value: r.stats.servicos_criados ?? 0 },
        { label: 'Receitas agrupadas', value: r.stats.receitas_alocadas ?? 0 },
        { label: 'Receitas rateadas', value: r.stats.receitas_rateadas ?? 0 },
        { label: 'Serviços com quantidade manual', value: r.stats.servicos_qtd_manual ?? 0 },
        { label: 'Itens atualizados', value: r.stats.atualizados ?? 0 },
        { label: 'Itens ignorados', value: r.stats.pulados ?? 0 },
        { label: 'Alocações mantidas', value: r.stats.alocacoes_puladas ?? 0 }
      ]}
    />
  )
}
