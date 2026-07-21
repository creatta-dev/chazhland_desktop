// Конфиг ESLint 9 (flat config) для десктоп-клиента chazhland.
// Три зоны: renderer (src, React + DOM), electron (main/preload, Node),
// и конфиги сборки в корне.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Неиспользуемые сущности с префиксом `_` считаем намеренными —
// так же, как настроены noUnusedLocals/noUnusedParameters в tsconfig.
const noUnusedVars = [
  'warn',
  {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
  },
]

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'build/**',
      'resources/**',
      'node_modules/**',
    ],
  },

  // Renderer: React 19 + DOM
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // only-export-components ловит файлы, где рядом с компонентом лежит хук/константа
      // (Avatar, ThemeProvider, auth, markdown). Это чинится только раздачей кода по новым
      // файлам ради гранулярности Fast Refresh в dev — в Electron-клиенте выгода нулевая,
      // а связность падает. Правило выключено осознанно.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': noUnusedVars,
      'no-unused-vars': 'off',
      // В коде много интеграций с untyped-мостами (electron, livekit, webtorrent) —
      // `any` там осознанный, ловить его отдельной волной.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // В проекте принят компактный стиль `cond ? a() : b()` и `cond && a()`
      // как оператор — не считаем это «выражением без эффекта».
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],
    },
  },

  // Electron main / preload / скрипты сборки: среда Node
  {
    files: ['electron/**/*.ts', 'vite.config.ts', 'scripts/**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],
    },
  },

  // Файлы деклараций: там намеренно пустые интерфейсы и глобальные типы
  {
    files: ['src/**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
)
