import { type ReactNode } from 'react'
import { ImportTemplateDialog } from '@/components/import/ImportTemplateDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import { useRecursos } from '../hooks/recursos'
import { useImportarRecursos } from '../hooks/importacao'
import {
  gerarModeloRecursos,
  parseRecursos,
  recursosToPayload,
  RECURSOS_SPEC,
  type RecursoLinha
} from '@/lib/xlsx/templates/recursos'
import { RECURSO_GRUPO_LABEL } from '@/types/orcamento'
import { fmtBRL4 } from '@/lib/money'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

interface Opcoes {
  atualizar_existentes: boolean
  atualizar_precos: boolean
}

export function ImportRecursosDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const scope = useCurrentScope()
  const empresa = useEmpresaAtual()
  const { data: recursos = [] } = useRecursos(obraId)
  const importar = useImportarRecursos()

  return (
    <ImportTemplateDialog<RecursoLinha, Opcoes>
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar recursos"
      entidadeLabel="recursos"
      gerarModelo={() =>
        gerarModeloRecursos({
          empresaNome: empresa?.nome ?? '',
          obraCodigo: scope.obra?.codigo ?? '',
          obraNome: scope.obra?.nome ?? ''
        })
      }
      nomeArquivoModelo={RECURSOS_SPEC.fileName}
      parse={(wb) => parseRecursos(wb, { recursos })}
      previewColumns={[
        {
          key: 'grupo',
          header: 'Grupo',
          render: (r) => RECURSO_GRUPO_LABEL[r.data.grupo] ?? r.data.grupo,
          width: 110
        },
        {
          key: 'codigo',
          header: 'Código',
          render: (r) => r.data.codigo ?? '—',
          width: 90
        },
        { key: 'nome', header: 'Nome', render: (r) => r.data.nome },
        {
          key: 'unidade',
          header: 'Unidade',
          render: (r) => r.data.unidade,
          width: 80
        },
        {
          key: 'preco',
          header: 'Preço',
          render: (r) => (r.data.preco != null ? fmtBRL4(r.data.preco) : '—'),
          align: 'right',
          width: 110
        }
      ]}
      opcoes={{
        inicial: { atualizar_existentes: true, atualizar_precos: true },
        render: (v, set) => (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={v.atualizar_existentes}
                onChange={(e) => set({ ...v, atualizar_existentes: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Atualizar nome, unidade e código dos recursos que já existem
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={v.atualizar_precos}
                onChange={(e) => set({ ...v, atualizar_precos: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              O preço informado vira o preço vigente
            </label>
          </div>
        )
      }}
      aplicar={(rows, opt) =>
        importar.mutateAsync({
          obra_id: obraId,
          linhas: recursosToPayload(rows),
          opcoes: {
            atualizar_existentes: opt.atualizar_existentes,
            atualizar_precos: opt.atualizar_precos
          }
        })
      }
      resultadoMetrics={(r) => [
        { label: 'Recursos criados', value: r.stats.criados ?? 0 },
        { label: 'Recursos atualizados', value: r.stats.atualizados ?? 0 },
        { label: 'Sem alteração', value: r.stats.inalterados ?? 0 },
        { label: 'Preços criados', value: r.stats.precos_criados ?? 0 }
      ]}
    />
  )
}
