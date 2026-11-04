import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { parseQtd } from '@/features/acompanhamento/lib/parse-qtd'
import {
  TIPO_VEICULO_LABEL,
  useExcluirVeiculo,
  useFrota,
  useSalvarVeiculo,
  type TipoVeiculo,
  type Veiculo
} from '@/features/acompanhamento/hooks/viagens'

export function GerencialFrotaPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro']} pageTitle="Frota">
      <Inner />
    </RequireRole>
  )
}

const TIPOS = Object.keys(TIPO_VEICULO_LABEL) as TipoVeiculo[]
const txt = (v: number | null): string => (v === null ? '' : String(v).replace('.', ','))

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const empresaId = scope.empresaId
  const { data: frota = [], isLoading } = useFrota(empresaId)
  const salvar = useSalvarVeiculo()
  const excluir = useExcluirVeiculo()
  const [novo, setNovo] = useState({ prefixo: '', placa: '', tipo: 'basculante' as TipoVeiculo })
  const erro = (e: Error): void => void toast.error(e.message)

  if (!empresaId)
    return (
      <div className="p-6 text-xs text-text-muted">Selecione a empresa para cadastrar a frota.</div>
    )
  const set = (v: Veiculo, patch: Partial<Veiculo>): void =>
    salvar.mutate(
      { ...patch, id: v.id, empresa_id: v.empresa_id, prefixo: patch.prefixo ?? v.prefixo },
      { onError: erro }
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Frota"
        subtitle="Caminhões e veículos da empresa — usados no registro de viagens de todas as obras."
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="w-full min-w-[900px] border-collapse rounded border border-border bg-bg-panel text-xs">
          <thead>
            <tr className="border-b border-border text-left text-2xs font-mono uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2 font-normal">Prefixo</th>
              <th className="px-2 py-2 font-normal">Placa</th>
              <th className="px-2 py-2 font-normal">Tipo</th>
              <th className="px-2 py-2 font-normal">Modelo</th>
              <th className="px-2 py-2 font-normal">Propriedade</th>
              <th className="px-2 py-2 font-normal">Fornecedor</th>
              <th className="px-2 py-2 font-normal">Cap. m³</th>
              <th className="px-2 py-2 font-normal">Cap. t</th>
              <th className="px-2 py-2 font-normal">Ativo</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {frota.map((v) => (
              <tr key={v.id} className="border-b border-border/50">
                {(['prefixo', 'placa'] as const).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <Input
                      key={`${v.id}-${v[k]}`}
                      defaultValue={v[k] ?? ''}
                      onBlur={(e) => {
                        const x = e.target.value.trim()
                        if (x !== (v[k] ?? '') && (k !== 'prefixo' || x)) set(v, { [k]: x || null })
                      }}
                      className="h-7 font-mono text-xs"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <Select
                    value={v.tipo}
                    onChange={(e) => set(v, { tipo: e.target.value as TipoVeiculo })}
                    className="h-7 text-xs"
                  >
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {TIPO_VEICULO_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </td>
                {(['modelo'] as const).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <Input
                      key={`${v.id}-${v[k]}`}
                      defaultValue={v[k] ?? ''}
                      onBlur={(e) =>
                        e.target.value.trim() !== (v[k] ?? '') &&
                        set(v, { [k]: e.target.value.trim() || null })
                      }
                      className="h-7 text-xs"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <Select
                    value={v.proprietario}
                    onChange={(e) =>
                      set(v, { proprietario: e.target.value as Veiculo['proprietario'] })
                    }
                    className="h-7 text-xs"
                  >
                    <option value="proprio">Próprio</option>
                    <option value="terceiro">Terceiro</option>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    key={`${v.id}-${v.fornecedor}`}
                    defaultValue={v.fornecedor ?? ''}
                    disabled={v.proprietario === 'proprio'}
                    onBlur={(e) =>
                      e.target.value.trim() !== (v.fornecedor ?? '') &&
                      set(v, { fornecedor: e.target.value.trim() || null })
                    }
                    className="h-7 text-xs"
                  />
                </td>
                {(['capacidade_m3', 'capacidade_t'] as const).map((k) => (
                  <td key={k} className="px-2 py-1">
                    <Input
                      key={`${v.id}-${v[k]}`}
                      defaultValue={txt(v[k])}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const x = parseQtd(e.target.value)
                        if (x !== v[k]) set(v, { [k]: x })
                      }}
                      className="h-7 w-20 text-right font-mono text-xs"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={v.ativo}
                    onChange={(e) => set(v, { ativo: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-1">
                  <button
                    type="button"
                    title="Excluir (fichas antigas ficam sem veículo; prefira desativar)"
                    onClick={() => excluir.mutate(v.id, { onError: erro })}
                    className="text-text-dim hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!frota.length && !isLoading ? (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-text-dim">
                  Nenhum veículo cadastrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!novo.prefixo.trim()) return
            salvar.mutate(
              {
                empresa_id: empresaId,
                prefixo: novo.prefixo.trim(),
                placa: novo.placa.trim() || null,
                tipo: novo.tipo
              },
              { onSuccess: () => setNovo({ ...novo, prefixo: '', placa: '' }), onError: erro }
            )
          }}
        >
          <Input
            value={novo.prefixo}
            onChange={(e) => setNovo({ ...novo, prefixo: e.target.value })}
            placeholder="Prefixo (ex.: CB-12)"
            className="h-7 w-40 font-mono text-xs"
          />
          <Input
            value={novo.placa}
            onChange={(e) => setNovo({ ...novo, placa: e.target.value })}
            placeholder="Placa"
            className="h-7 w-32 font-mono text-xs"
          />
          <Select
            value={novo.tipo}
            onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoVeiculo })}
            className="h-7 w-36 text-xs"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_VEICULO_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit">
            <Plus size={12} /> Incluir veículo
          </Button>
        </form>
      </div>
    </div>
  )
}
