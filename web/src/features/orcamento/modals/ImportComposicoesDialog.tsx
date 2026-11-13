import { type ReactNode } from 'react'
import { ImportTemplateDialog } from '@/components/import/ImportTemplateDialog'
import { Campo } from '@/components/ui/campo'
import { Select } from '@/components/ui/select'
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
      titulo="Importar composições"
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
          render: (r) => r.data.codigo,
          width: 90
        },
        { key: 'nome', header: 'Serviço', render: (r) => r.data.nome },
        {
          key: 'unidade',
          header: 'Unidade',
          render: (r) => r.data.unidade ?? <span className="text-text-muted">Grupo</span>,
          width: 80
        },
        {
          key: 'prod',
          header: 'Produção por dia',
          render: (r) => (r.data.producao_qtde != null ? fmtQtd(r.data.producao_qtde) : '—'),
          align: 'right',
          width: 130
        },
        {
          key: 'itens',
          header: 'Insumos',
          render: (r) => (r.data.unidade ? String(r.data.itens.length) : '—'),
          align: 'right',
          width: 80
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
            <div className="grid gap-3 md:grid-cols-3">
              <Campo rotulo="Composições que já existem">
                <Select
                  value={v.modo_existente}
                  onChange={(e) => set({ ...v, modo_existente: e.target.value as ModoExistente })}
                >
                  <option value="substituir_itens">Substituir os insumos (mesma versão)</option>
                  <option value="nova_versao">Criar nova versão vigente</option>
                  <option value="pular">Ignorar</option>
                  <option value="erro">Tratar como erro</option>
                </Select>
              </Campo>
              <Campo
                rotulo="Combustível padrão"
                dica={
                  precisaComb
                    ? 'Há composição com equipamento (L/h) sem linha de combustível: escolha o combustível que entra nela.'
                    : 'Usado em composição com equipamento (L/h) sem linha de combustível.'
                }
              >
                <Select
                  value={v.combustivel_padrao_recurso_id ?? ''}
                  onChange={(e) =>
                    set({ ...v, combustivel_padrao_recurso_id: e.target.value || null })
                  }
                >
                  <option value="">Não adicionar</option>
                  {combustiveis.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.unidade})
                    </option>
                  ))}
                </Select>
              </Campo>
              <label className="flex cursor-pointer items-center gap-1.5 self-start pt-7 text-sm text-text">
                <input
                  type="checkbox"
                  checked={v.criar_recursos_faltantes}
                  onChange={(e) => set({ ...v, criar_recursos_faltantes: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Criar os recursos que ainda não existem
              </label>
            </div>
          )
        }
      }}
      acaoEfetiva={(acao, opt) =>
        acao !== 'atualizar'
          ? acao
          : opt.modo_existente === 'pular'
            ? 'pular'
            : opt.modo_existente === 'erro'
              ? 'erro'
              : acao
      }
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
        { label: 'Serviços criados', value: r.stats.servicos_criados ?? 0 },
        { label: 'Composições criadas', value: r.stats.cpus_criadas ?? 0 },
        { label: 'Composições atualizadas', value: r.stats.cpus_atualizadas ?? 0 },
        { label: 'Insumos', value: r.stats.itens_criados ?? 0 },
        { label: 'Grupos criados', value: r.stats.grupos_criados ?? 0 },
        { label: 'Recursos criados', value: r.stats.recursos_criados ?? 0 },
        { label: 'Preços criados', value: r.stats.precos_criados ?? 0 },
        { label: 'Composições ignoradas', value: r.stats.cpus_puladas ?? 0 }
      ]}
    />
  )
}
