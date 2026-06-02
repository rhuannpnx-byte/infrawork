import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fmtBRL, fmtBRL4, fmtQtd, parseBR } from '@/lib/money'
import type { CpuItemComRecurso, CpuItemGrupo, Recurso } from '@/types/orcamento'
import { CPU_ITEM_GRUPO_LABEL, CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS } from '@/types/orcamento'
import { useDeleteCpuItem, useUpsertCpuItem } from '../hooks/cpus'
import { cn } from '@/lib/utils'

interface Props {
  cpuId: string
  grupo: CpuItemGrupo
  itens: CpuItemComRecurso[]
  recursos: Recurso[]
  /** Produção/dia da CPU — usado pra derivar qty em MATERIAL. */
  producaoDiaria: number
  /** Unidade da produção (T, M², etc.) — usado em tooltip de MATERIAL. */
  producaoUnidade?: string | null
}

/**
 * Tabela editável genérica para os 4 blocos da CPU.
 * - Cada bloco mostra colunas específicas ao grupo.
 * - Insert/Update via mutations; UI dispara onBlur.
 */
export function CpuItemsTable({
  cpuId,
  grupo,
  itens,
  recursos,
  producaoDiaria,
  producaoUnidade
}: Props): ReactNode {
  const upsert = useUpsertCpuItem()
  const remove = useDeleteCpuItem()

  const recursosElegiveis = recursos.filter((r) =>
    CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS[grupo].includes(r.grupo)
  )

  const [addingRecursoId, setAddingRecursoId] = useState<string>('')

  const handleAdd = (): void => {
    if (!addingRecursoId) return
    const proximoOrdem = itens.length
    const base = {
      cpu_id: cpuId,
      grupo,
      recurso_id: addingRecursoId,
      quantidade: 1,
      indice_produtividade: 1.0,
      ordem: proximoOrdem
    }
    const payload =
      grupo === 'EQUIPAMENTO'
        ? { ...base, horas_dia: 8, consumo_combustivel_lh: null }
        : grupo === 'MO'
          ? { ...base, horas_dia: 8 }
          : { ...base }
    upsert.mutate(payload)
    setAddingRecursoId('')
  }

  const columns: { key: string; label: string; title?: string }[] = [
    { key: 'recurso', label: 'Recurso' },
    { key: 'unidade', label: 'Un.' },
    { key: 'preco', label: 'Preço vig.' }
  ]
  // MATERIAL: Consumo/un. é o input; Qtde é DERIVADA (consumo × prod/dia).
  if (grupo === 'MATERIAL') {
    columns.push({
      key: 'consumo_un',
      label: 'Consumo/un.',
      title: 'Consumo do material por unidade produzida'
    })
    columns.push({
      key: 'qtde_calc',
      label: 'Qtde (calc.)',
      title: `Quantidade derivada = consumo × produção/dia (${fmtQtd(producaoDiaria)} ${
        producaoUnidade ?? ''
      })`
    })
  } else {
    columns.push({ key: 'quantidade', label: 'Qtde' })
  }
  if (grupo === 'EQUIPAMENTO' || grupo === 'MO') columns.push({ key: 'horas', label: 'h/dia' })
  if (grupo === 'EQUIPAMENTO') {
    columns.push({ key: 'consumo', label: 'L/h' })
    columns.push({ key: 'indice', label: 'Índ. prod.' })
  }
  columns.push({ key: 'custo', label: 'Custo total' })
  columns.push({ key: 'acoes', label: '' })

  return (
    <div className="rounded border border-border bg-bg-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated">
        <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
          {CPU_ITEM_GRUPO_LABEL[grupo]}
        </h3>
        <div className="text-2xs text-text-dim font-mono">{itens.length} item(s)</div>
      </div>
      <table className="w-full text-xs font-mono">
        <thead className="text-2xs text-text-dim uppercase">
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left px-2 py-1.5 font-normal"
                title={c.title}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-3 text-text-dim text-center">
                Nenhum item neste bloco.
              </td>
            </tr>
          ) : (
            itens.map((it) => (
              <CpuItemRow
                key={it.id}
                item={it}
                grupo={grupo}
                producaoDiaria={producaoDiaria}
                onSave={(patch) => upsert.mutate({ id: it.id, ...patch })}
                onDelete={() => remove.mutate({ id: it.id, cpu_id: cpuId })}
              />
            ))
          )}
        </tbody>
      </table>

      <div className="border-t border-border px-3 py-2 flex items-center gap-2">
        <div className="flex-1 max-w-md">
          <Select
            value={addingRecursoId}
            onChange={(e) => setAddingRecursoId(e.target.value)}
            disabled={recursosElegiveis.length === 0}
          >
            <option value="">
              {recursosElegiveis.length === 0
                ? `Nenhum recurso de ${CPU_ITEM_GRUPO_LABEL[grupo]} cadastrado`
                : `Adicionar ${CPU_ITEM_GRUPO_LABEL[grupo].toLowerCase()}…`}
            </option>
            {recursosElegiveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome} ({r.unidade})
                {r.preco_vigente !== null && r.preco_vigente !== undefined
                  ? ` · ${fmtBRL4(r.preco_vigente)}`
                  : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAdd}
          disabled={!addingRecursoId || upsert.isPending}
        >
          <Plus size={11} /> Adicionar
        </Button>
      </div>
    </div>
  )
}

interface RowProps {
  item: CpuItemComRecurso
  grupo: CpuItemGrupo
  producaoDiaria: number
  onSave: (patch: {
    cpu_id: string
    grupo: CpuItemGrupo
    recurso_id: string
    quantidade: number
    horas_dia?: number | null
    consumo_combustivel_lh?: number | null
    indice_produtividade?: number
    consumo_material_por_unid?: number | null
    ordem?: number
  }) => void
  onDelete: () => void
}

function CpuItemRow({ item, grupo, producaoDiaria, onSave, onDelete }: RowProps): ReactNode {
  const [quantidade, setQuantidade] = useState(String(item.quantidade ?? 0))
  const [horasDia, setHorasDia] = useState(item.horas_dia !== null ? String(item.horas_dia) : '')
  const [consumo, setConsumo] = useState(
    item.consumo_combustivel_lh !== null ? String(item.consumo_combustivel_lh) : ''
  )
  const [indice, setIndice] = useState(String(item.indice_produtividade ?? 1))
  const [consumoUn, setConsumoUn] = useState(
    item.consumo_material_por_unid !== null ? String(item.consumo_material_por_unid) : ''
  )

  const commit = (): void => {
    onSave({
      cpu_id: item.cpu_id,
      grupo,
      recurso_id: item.recurso_id,
      quantidade: parseN(quantidade),
      horas_dia: ['EQUIPAMENTO', 'MO'].includes(grupo) ? parseN(horasDia) : null,
      consumo_combustivel_lh: grupo === 'EQUIPAMENTO' ? parseNOpt(consumo) : null,
      indice_produtividade: grupo === 'EQUIPAMENTO' ? parseN(indice) : 1.0,
      consumo_material_por_unid: grupo === 'MATERIAL' ? parseNOpt(consumoUn) : null,
      ordem: item.ordem
    })
  }

  return (
    <tr className="border-b border-border/40">
      <td className="px-2 py-1 text-text truncate max-w-[280px]" title={item.recurso?.nome}>
        {item.recurso?.nome ?? '—'}
      </td>
      <td className="px-2 py-1 text-text-dim">{item.recurso?.unidade ?? '—'}</td>
      <td className="px-2 py-1 text-text-muted">
        {item.recurso?.preco_vigente !== null && item.recurso?.preco_vigente !== undefined
          ? fmtBRL4(item.recurso.preco_vigente)
          : '—'}
      </td>
      {grupo === 'MATERIAL' ? (
        <>
          <td className="px-2 py-1">
            <Input
              value={consumoUn}
              onChange={(e) => setConsumoUn(e.target.value)}
              onBlur={commit}
              inputMode="decimal"
              className="h-6 text-right"
            />
          </td>
          <td
            className="px-2 py-1 text-right tabular-nums text-text-muted"
            title={`${parseN(consumoUn || '0')} × ${producaoDiaria} = ${
              parseN(consumoUn || '0') * producaoDiaria
            }`}
          >
            {consumoUn?.trim()
              ? fmtQtd(parseN(consumoUn) * producaoDiaria)
              : '—'}
          </td>
        </>
      ) : (
        <td className="px-2 py-1">
          <Input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="h-6 text-right"
          />
        </td>
      )}
      {grupo === 'EQUIPAMENTO' || grupo === 'MO' ? (
        <td className="px-2 py-1">
          <Input
            value={horasDia}
            onChange={(e) => setHorasDia(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="h-6 text-right"
          />
        </td>
      ) : null}
      {grupo === 'EQUIPAMENTO' ? (
        <>
          <td className="px-2 py-1">
            <Input
              value={consumo}
              onChange={(e) => setConsumo(e.target.value)}
              onBlur={commit}
              inputMode="decimal"
              className="h-6 text-right"
            />
          </td>
          <td className="px-2 py-1">
            <Input
              value={indice}
              onChange={(e) => setIndice(e.target.value)}
              onBlur={commit}
              inputMode="decimal"
              className="h-6 text-right"
            />
          </td>
        </>
      ) : null}
      <td className={cn('px-2 py-1 text-right tabular-nums', 'text-text font-medium')}>
        {fmtBRL(item.custo_total_calc)}
      </td>
      <td className="px-2 py-1 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-danger/10"
          title="Remover"
        >
          <Trash2 size={11} />
        </button>
      </td>
    </tr>
  )
}

function parseN(s: string): number {
  // parseBR: aceita "1.234,56" (BR) e "1234.56" (raw). Evita perda silenciosa.
  const n = parseBR(s ?? '').toNumber()
  return isNaN(n) ? 0 : n
}

function parseNOpt(s: string): number | null {
  if (!s?.trim()) return null
  return parseN(s)
}
