import { type ReactNode } from 'react'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import type { LucratividadeResumo } from '@/types/orcamento'

interface Props {
  data: LucratividadeResumo
}

export function LucratividadeCards({ data }: Props): ReactNode {
  const tomLucro = data.lucro_liquido < 0 ? 'danger' : data.lucro_liquido > 0 ? 'success' : 'neutro'
  return (
    <FaixaIndicadores rotulo="Resumo da lucratividade">
      <Indicador rotulo="Venda total" valor={fmtBRL(data.venda_total)} tamanho="sm">
        <span>Planilha orçamentária</span>
      </Indicador>
      <Indicador rotulo="Custo direto" valor={fmtBRL(data.custo_direto)} tamanho="sm">
        <span>Serviços, sem os indiretos</span>
      </Indicador>
      <Indicador rotulo="Custo indireto" valor={fmtBRL(data.custo_indireto)} tamanho="sm">
        <span>
          {data.custo_indireto_vinculado > 0
            ? `${fmtBRL(data.custo_indireto_vinculado)} pela planilha e ${fmtBRL(data.custo_indireto_standalone)} lançados em custos indiretos`
            : 'Mobilização, administração local e outros'}
        </span>
      </Indicador>
      <Indicador rotulo="Impostos" valor={fmtBRL(data.impostos)} tamanho="sm">
        <span>{fmtPct2(data.aliquota_total_perc)} sobre a venda</span>
      </Indicador>
      <Indicador
        rotulo="Lucro líquido"
        valor={fmtBRL(data.lucro_liquido)}
        tamanho="sm"
        tom={tomLucro}
      >
        <span>
          {data.margem_perc !== null
            ? `Margem de ${fmtPct2(data.margem_perc)}`
            : 'Sem venda para calcular a margem'}
        </span>
      </Indicador>
    </FaixaIndicadores>
  )
}
