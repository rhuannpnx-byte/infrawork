import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { ImportTemplateDialog } from '@/components/import/ImportTemplateDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { parametroDe, useParametrosServicos } from '@/features/planejamento/hooks/parametros'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { rotuloLocalProducao } from '../../lib/local-producao'
import { hojeLocalISO } from '@/lib/format/local-date'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { normalizeTxt } from '@/lib/xlsx/parse-sheet'
import type { ImportResultado } from '@/lib/xlsx/types'
import {
  gerarModeloProducao,
  parseProducao,
  producaoToInputs,
  PRODUCAO_SPEC,
  type ProducaoLinha
} from '@/lib/xlsx/templates/producao'
import {
  useCreateEncarregado,
  useCreateLancamentosLote,
  useDesfazerImportacao,
  useEncarregados,
  useItensLancaveis
} from '../../hooks/lancamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  onImportado?: (importacaoId: string | null, inseridos: number) => void
}

interface Opcoes {
  criar_encarregados: boolean
}

export function ImportarProducaoDialog({
  open,
  onOpenChange,
  obraId,
  onImportado
}: Props): ReactNode {
  const scope = useCurrentScope()
  const empresa = useEmpresaAtual()
  const { data: itens = [] } = useItensLancaveis(obraId)
  const { data: equipes = [] } = useEquipes(obraId)
  const { data: encarregados = [] } = useEncarregados(obraId, true)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const { data: parametros } = useParametrosServicos(obraId)
  const criarEnc = useCreateEncarregado()
  const lote = useCreateLancamentosLote()
  const desfazer = useDesfazerImportacao()

  const aplicar = async (
    rows: Parameters<typeof producaoToInputs>[0],
    opt: Opcoes
  ): Promise<ImportResultado> => {
    const t0 = Date.now()
    const avisos: string[] = []
    const erros: string[] = []
    // 1) Encarregados novos (nomes sem id), de-duplicados por nome normalizado.
    const idPorNome = new Map<string, string>()
    for (const e of encarregados) {
      idPorNome.set(normalizeTxt(e.nome), e.id)
      if (e.apelido) idPorNome.set(normalizeTxt(e.apelido), e.id)
    }
    let criados = 0
    if (opt.criar_encarregados) {
      const novos = new Map<string, string>()
      for (const r of rows) {
        const nome = r.data.encarregado_nome?.trim()
        if (!nome || r.data.encarregado_id) continue
        const k = normalizeTxt(nome)
        if (!idPorNome.has(k) && !novos.has(k)) novos.set(k, nome)
      }
      for (const [k, nome] of novos) {
        try {
          const e = await criarEnc.mutateAsync({ obra_id: obraId, nome })
          idPorNome.set(k, e.id)
          criados++
        } catch (err) {
          erros.push(
            `Encarregado "${nome}": ${err instanceof Error ? err.message : 'falha ao criar'}`
          )
        }
      }
    } else {
      const semId = rows.filter((r) => r.data.encarregado_nome && !r.data.encarregado_id).length
      if (semId > 0)
        avisos.push(
          `${contar(semId, 'linha com encarregado desconhecido importada', 'linhas com encarregado desconhecido importadas')} sem encarregado.`
        )
    }
    // 2) Lançamentos (lote único com importacao_id para desfazer).
    // parametrização: serviço por viagens não recebe quantidade; local obrigatório sem local não entra
    const todas = producaoToInputs(rows, obraId, idPorNome)
    const porViagens = todas.filter(
      (l) => parametroDe(parametros, l.item_orcamentario_id).modo_lancamento === 'viagens'
    )
    const semLocal = todas.filter(
      (l) => parametroDe(parametros, l.item_orcamentario_id).exige_local && !l.trecho_id
    )
    if (porViagens.length)
      avisos.push(
        `${contar(porViagens.length, 'linha de serviço alimentado por viagens foi ignorada', 'linhas de serviços alimentados por viagens foram ignoradas')} (lance as viagens).`
      )
    if (semLocal.length)
      avisos.push(
        `${contar(semLocal.length, 'linha sem local foi ignorada', 'linhas sem local foram ignoradas')} (o serviço exige local e estacas).`
      )
    const linhas = todas.filter((l) => !porViagens.includes(l) && !semLocal.includes(l))
    const r = await lote.mutateAsync({ linhas, origem: 'importacao' })
    onImportado?.(r.importacao_id, r.inseridos)
    if (r.importacao_id) {
      const id = r.importacao_id
      toast.success(`${contar(r.inseridos, 'lançamento importado', 'lançamentos importados')}.`, {
        duration: 15000,
        action: {
          label: 'Desfazer',
          onClick: () => {
            void desfazer
              .mutateAsync({ importacao_id: id })
              .then((n) =>
                toast.info(`${contar(n, 'lançamento removido', 'lançamentos removidos')}.`)
              )
          }
        }
      })
    }
    return {
      ok: erros.length === 0,
      stats: { inseridos: r.inseridos, encarregados_criados: criados },
      erros,
      avisos,
      duracao_ms: Date.now() - t0
    }
  }

  return (
    <ImportTemplateDialog<ProducaoLinha, Opcoes>
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar produção (modelo padrão)"
      entidadeLabel="lançamentos"
      gerarModelo={() =>
        gerarModeloProducao(
          {
            empresaNome: empresa?.nome ?? '',
            obraCodigo: scope.obra?.codigo ?? '',
            obraNome: scope.obra?.nome ?? ''
          },
          itens,
          trechos
        )
      }
      nomeArquivoModelo={PRODUCAO_SPEC.fileName}
      parse={(wb) =>
        parseProducao(wb, {
          itens,
          equipes: equipes.map((e) => ({ id: e.id, nome: e.nome })),
          encarregados,
          trechos,
          hojeISO: hojeLocalISO(),
          parametro: (id) => parametroDe(parametros, id)
        })
      }
      previewColumns={[
        {
          key: 'data',
          header: 'Data',
          render: (r) => <span className="font-mono text-2xs">{r.data.data || '—'}</span>,
          width: 90
        },
        {
          key: 'codigo',
          header: 'Item',
          render: (r) => <span className="font-mono text-2xs">{r.data.codigo_item}</span>,
          width: 90
        },
        { key: 'equipe', header: 'Equipe', render: (r) => r.data.equipe_nome ?? '—', width: 140 },
        {
          key: 'enc',
          header: 'Encarregado',
          render: (r) => r.data.encarregado_nome ?? '—',
          width: 140
        },
        {
          key: 'qtd',
          header: 'Qtd',
          render: (r) => formatNumber(r.data.quantidade, 2),
          align: 'right',
          width: 90
        },
        { key: 'frente', header: 'Frente', render: (r) => r.data.frente ?? '—', width: 120 },
        {
          key: 'local',
          header: 'Local / estacas',
          render: (r) => {
            const t = trechos.find((x) => x.id === r.data.trecho_id)
            return (
              rotuloLocalProducao({
                trecho_nome: t?.nome ?? r.data.local_nome,
                trecho_tipo: t?.tipo ?? null,
                estaca_inicial: r.data.estaca_inicial,
                estaca_final: r.data.estaca_final
              }) || '—'
            )
          }
        }
      ]}
      opcoes={{
        inicial: { criar_encarregados: true },
        render: (v, set) => (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-text">
            <input
              type="checkbox"
              checked={v.criar_encarregados}
              onChange={(e) => set({ ...v, criar_encarregados: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            Criar encarregados que não existem
          </label>
        )
      }}
      aplicar={aplicar}
      resultadoMetrics={(r) => [
        { label: 'lançamentos', value: r.stats.inseridos ?? 0 },
        { label: 'encarregados criados', value: r.stats.encarregados_criados ?? 0 }
      ]}
    />
  )
}
