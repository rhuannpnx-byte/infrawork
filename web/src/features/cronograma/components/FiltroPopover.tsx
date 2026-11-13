/** Botão + painel do filtro da visão: tarefa-resumo, locais (trechos/áreas/sem local), serviços e equipes. */
import { useState, type ReactNode } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import type { PlanoEntrada } from '../motor/tipos'
import { criteriosAtivos, FILTRO_VAZIO, SEM_LOCAL_FILTRO, type FiltroVisao } from '../visoes/filtro'
import { Caixa, Campo } from './campos'

interface Props {
  entrada: PlanoEntrada
  filtro: FiltroVisao
  onChange: (f: FiltroVisao) => void
}

export function FiltroPopover({ entrada: e, filtro, onChange }: Props): ReactNode {
  const [aberto, setAberto] = useState(false)
  const n = criteriosAtivos(filtro)
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const caminho = (id: string): string => {
    const nomes: string[] = []
    for (let x: string | null = id; x; x = porId.get(x)?.parent_id ?? null)
      nomes.unshift(porId.get(x)?.nome ?? '')
    return nomes.join(' › ')
  }
  const grupos = e.tarefas.filter((t) => t.tipo_no === 'grupo')
  const alternar = (campo: 'trechos' | 'servicos' | 'equipes', id: string, on: boolean): void => {
    const atual = new Set(filtro[campo] ?? [])
    if (on) atual.add(id)
    else atual.delete(id)
    onChange({ ...filtro, [campo]: atual.size ? [...atual] : null })
  }
  const lista = (
    titulo: string,
    campo: 'trechos' | 'servicos' | 'equipes',
    itens: { id: string; rotulo: string }[]
  ): ReactNode =>
    itens.length ? (
      <div className="space-y-1">
        <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
          {titulo}
        </div>
        <div className="max-h-36 space-y-0.5 overflow-auto pr-1">
          {itens.map((i) => (
            <Caixa
              key={i.id}
              marcado={!!filtro[campo]?.includes(i.id)}
              onMudar={(v) => alternar(campo, i.id, v)}
            >
              <span className="truncate">{i.rotulo}</span>
            </Caixa>
          ))}
        </div>
      </div>
    ) : null

  return (
    <Popover
      open={aberto}
      onOpenChange={setAberto}
      trigger={
        <Button
          variant={n ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setAberto((x) => !x)}
          title="Filtrar as tarefas da visão (o Gantt e o tempo-caminho usam o mesmo filtro)"
        >
          <Filter size={12} /> Filtro{n ? ` (${n})` : ''}
        </Button>
      }
    >
      <div className="w-80 space-y-3 p-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
            Filtro da visão
          </span>
          {n ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
              onClick={() => onChange(FILTRO_VAZIO)}
            >
              <X size={12} /> Limpar
            </button>
          ) : null}
        </div>
        <Campo rotulo="Tarefa-resumo">
          <Select
            value={filtro.resumo ?? ''}
            onChange={(x) => onChange({ ...filtro, resumo: x.target.value || null })}
          >
            <option value="">Todas</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {caminho(g.id)}
              </option>
            ))}
          </Select>
        </Campo>
        {lista('Locais', 'trechos', [
          ...e.trechos.map((t) => ({
            id: t.id,
            rotulo: t.tipo === 'area' ? `Área ${t.nome}` : t.nome
          })),
          { id: SEM_LOCAL_FILTRO, rotulo: 'Sem local' }
        ])}
        {lista(
          'Serviços',
          'servicos',
          e.servicos.map((s) => ({ id: s.id, rotulo: `${s.codigo} ${s.nome}`.trim() }))
        )}
        {lista(
          'Equipes nomeadas',
          'equipes',
          e.equipesNomeadas.map((q) => ({ id: q.id, rotulo: q.nome }))
        )}
        <p className="text-xs text-text-muted">
          Ficam as tarefas que passam em todos os critérios, com as suas tarefas-resumo. As tarefas
          fora do filtro continuam no plano e no cálculo.
        </p>
      </div>
    </Popover>
  )
}
