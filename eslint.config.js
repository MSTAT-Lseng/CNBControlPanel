const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'scripts/**'],
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/storage*', '@/services/parser*', '@/services/exchange*', '../services/*'],
              message: 'Router shell files may only import from @/services/ui or @/contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/storage*', '@/services/parser*', '../storage*', '../parser*'],
              message: 'UI service must never directly access Storage or Parser; go through Exchange.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/ui*', '@/services/parser*', '@/services/exchange*', '@/app*', '../ui*', '../parser*', '../exchange*'],
              message: 'Storage service is strictly isolated and may only import @/contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/parser/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/ui*', '@/services/storage*', '@/services/exchange*', '@/app*', '../ui*', '../storage*', '../exchange*'],
              message: 'Parser service is strictly isolated and may only import @/contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/exchange/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/ui*', '@/app*', '../ui*'],
              message: 'Exchange service must never import UI or Router shell.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/contracts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/services/*', '@/app*', '../services/*', '../app*'],
              message: 'Contracts layer must remain zero-dependency pure TypeScript interfaces.',
            },
          ],
        },
      ],
    },
  },
]);
