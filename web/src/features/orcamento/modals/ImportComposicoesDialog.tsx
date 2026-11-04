import { type ReactNode } from 'react'
import { ImportTemplateDialog } from '@/components/import/ImportTemplateDialog'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import { useRecursos } from '../hooks/recursos'
import { useServicos } from '../hooks/servicos'
import { useImportarComposicoes, type ModoExistente } from '../hooks/importacao'
import {
  COMPOSICOES_SPEC,
  composicoesToPayload,
  gerarModeloComposicoes,
  parseComposicoes,
  type ComposicaoLinha
} from '@/lib/xlsx/templates/composicoes'
import { fmtQtd } from '@/lib/money'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

interface Opcoes {
  modo_existente: ModoExistente
  criar_recursos_faltantes: boolean
  combustivel_padrao_recurso_id: string | null
}

export function ImportComposicoesDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const scope = useCurrentScope()
  const empresa = useEmpresaAtual()
  const { data: recursos = [] } = useRecursos(obraId)
  const { data: servicos = [] } = useServicos(obraId)
  const importar = useImportarComposicoes()
  const combustiveis = recursos.filter((r) => r.grupo === 'COMBUSTIVEL' && r.ativo)

  return (
    <ImportTemplateDialog<ComposicaoLinha, Opcoes>
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar composições (modelo padrão)"
      entidadeLabel="composições"
      gerarModelo={() =>
        gerarModeloComposicoes({
          empresaNome: empresa?.nome ?? '',
          obraCodigo: scope.obra?.codigo ?? '',
          obraNome: scope.obra?.nome ?? ''
        })
      }
      nomeArquivoModelo={COMPOSICOES_SPEC.fileName}
      parse={(wb) => parseComposicoes(wb, { recursos, servicos })}
      previewColumns={[
        {
          key: 'codigo',
          header: 'Código',
          render: (r) => <span className="font-mono">{r.data.codigo}</span>,
          width: 90
        },
        { key: 'nome', header: 'Serviço', render: (r) => r.data.nome },
        {
          key: 'unidade',
          header: 'Un.',
          render: (r) => <span className="font-mono">{r.data.unidade ?? 'grupo'}</span>,
          width: 60
        },
        {
          key: 'prod',
          header: 'Prod./dia',
          render: (r) => (r.data.producao_qtde != null ? fmtQtd(r.data.producao_qtde) : '—'),
          align: 'right',
          width: 90
        },
        {
          key: 'itens',
          header: 'Insumos',
          render: (r) => (r.data.unidade ? String(r.data.itens.length) : '—'),
          align: 'right',
          width: 70
        }
      ]}
      opcoes={{
        inicial: {
          modo_existente: 'substituir_itens',
          criar_recursos_faltantes: true,
          combustivel_padrao_recurso_id: combustiveis[0]?.id ?? null
        },
        render: (v, set, rows) => {
          const precisaComb = rows.some((r) =>
            r.avisos.some((a) => a.code === 'COMBUSTIVEL_AUSENTE')
          )
          return (
            <div className="grid gap-3 md:grid-cols-3 text-xs text-text">
              <div>
                <Label>Composições que já existem</Label>
                <Select
                  value={v.modo_existente}
                  onChange={(e) => set({ ...v, modo_existente: e.target.value as ModoExistente })}
                >
                  <option value="substituir_itens">Substituir os insumos (mesma versão)</option>
                  <option value="nova_versao">Criar nova versão vigente</option>
                  <option value="pular">Pular</option>
                  <option value="erro">Tratar como erro</option>
                </Select>
              </div>
              <div>
                <Label>Combustível padrão {precisaComb ? '(necessário)' : ''}</Label>
                <Select
                  value={v.combustivel_padrao_recurso_id ?? ''}
                  onChange={(e) =>
                    set({ ...v, combustivel_padrao_recurso_id: e.target.value || null })
                  }
                >
                  <option value="">— não adicionar —</option>
                  {combustiveis.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.unidade})
                    </option>
                  ))}
                </Select>
                <div className="mt-1 text-2xs text-text-dim">
                  Para composições com equipamentos (L/h) sem linha de combustível.
                </div>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer self-end pb-1">
                <input
                  type="checkbox"
                  checked={v.criar_recursos_faltantes}
                  onChange={(e) => set({ ...v, criar_recursos_faltantes: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                Criar recursos que não existem
              </label>
            </div>
          )
        }
      }}
      aplicar={(rows, opt) =>
        importar.mutateAsync({
          obra_id: obraId,
          composicoes: composicoesToPayload(rows),
          opcoes: {
            modo_existente: opt.modo_existente,
            criar_recursos_faltantes: opt.criar_recursos_faltantes,
            combustivel_padrao_recurso_id: opt.combustivel_padrao_recurso_id
          }
        })
      }
      resultadoMetrics={(r) => [
        { label: 'serviços criados', value: r.stats.servicos_criados ?? 0 },
        { label: 'composições criadas', value: r.stats.cpus_criadas ?? 0 },
        { label: 'composições atualizadas', value: r.stats.cpus_atualizadas ?? 0 },
        { label: 'insumos', value: r.stats.itens_criados ?? 0 },
        { label: 'grupos criados', value: r.stats.grupos_criados ?? 0 },
        { label: 'recursos criados', value: r.stats.recursos_criados ?? 0 },
        { label: 'preços criados', value: r.stats.precos_criados ?? 0 },
        { label: 'puladas', value: r.stats.cpus_puladas ?? 0 }
      ]}
    />
  )
}
