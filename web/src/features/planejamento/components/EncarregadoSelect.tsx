import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { useEncarregados } from '@/features/acompanhamento/hooks/lancamento'

/** Encarregado responsável pela equipe (ativos, mais o atual se estiver inativo). */
export function EncarregadoSelect({
  obraId,
  value,
  onChange
}: {
  obraId: string
  value: string
  onChange: (id: string) => void
}): ReactNode {
  const { data: encarregados = [] } = useEncarregados(obraId, true)
  const opcoes = encarregados.filter((en) => en.ativo || en.id === value)
  return (
    <div>
      <Label htmlFor="eq-encarregado">Encarregado</Label>
      <select
        id="eq-encarregado"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg border border-border rounded px-2 py-1 text-xs"
      >
        <option value="">— sem encarregado —</option>
        {opcoes.map((en) => (
          <option key={en.id} value={en.id}>
            {en.apelido ? `${en.nome} (${en.apelido})` : en.nome}
            {en.ativo ? '' : ' — inativo'}
          </option>
        ))}
      </select>
      <p className="mt-1 text-2xs text-text-dim">
        No app de campo, a equipe aparece para o encarregado escolhido.
      </p>
    </div>
  )
}
