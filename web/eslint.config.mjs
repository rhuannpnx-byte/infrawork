import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', 'supabase/functions/**', 'supabase/seeds/**', 'scripts/**', 'vendor/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // Regras novas do react-hooks v7 (orientadas ao React Compiler). O código
      // herdado do desktop usa setState em efeitos e refs em render em alguns
      // pontos; mantemos como aviso para não travar o CI, corrigindo aos poucos.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/static-components': 'warn',
      // Arquivos que exportam componente + helper (ex.: useConfirm, buttonVariants)
      // só perdem o Fast Refresh naquele módulo — não é erro de build.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Prefixo _ marca descarte intencional em destructuring (`{ obra_id: _o, ...rest }`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    // MCP: as ferramentas devolvem JSON livre para a IA (o contrato é o inputSchema de cada uma)
    files: ['mcp/**/*.{ts,mjs}'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  eslintConfigPrettier
)
