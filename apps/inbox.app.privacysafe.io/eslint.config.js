import eslintJs from '@eslint/js';
import tsEslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import pluginVue from 'eslint-plugin-vue';
// import pluginTsEslint from '@typescript-eslint/eslint-plugin';
import pluginPrettier from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/@types/**/*.*',
      '**/app/**/*.*',
      '**/ci/**/*.*',
      '**/doc/**/*.*',
      '**/public/**/*.*',
      '**/tests/report/**/*.*',
      '**/tests/app/public/**/*.*',
      'shared/libs/ipc/**/*.*',
      'shared/libs/sqlite-on-3nstorage/**/*.*',
      'src/libs/**/*.js',
      'src/libs/**/*.d.ts',
      'src/common/libs/**/*.js',
      'src/common/libs/**/*.d.ts',
      'src-deno/libs/**/*.*',
    ],
  },

  eslintJs.configs['recommended'],
  ...tsEslint.configs['recommended'],
  {
    files: ['**/*.{js,ts,jsx,tsx}'],
    plugins: {
      // '@typescript-eslint': pluginTsEslint,
      prettier: pluginPrettier,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
          modules: true,
          experimentalObjectRestSpread: true,
        },
      },
    },
    rules: {
      // The whole codebase is written this way already; the rule is here so that
      // it is the linter that keeps it so, and not everybody's memory.
      curly: ['error', 'all'],
      'max-len': [
        'error',
        {
          code: 120,
          ignoreComments: true,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
      'no-console': 'off',
      'no-debugger': 'off',
      'no-undef': 'off',
      'import/prefer-default-export': 'off',
      'default-case': 'off',
      'lines-between-class-members': 'off',
      'no-param-reassign': 'off',
      'no-return-assign': 'off',
      'arrow-parens': ['error', 'as-needed'],
      'object-curly-newline': [
        'error',
        {
          consistent: true,
        },
      ],

      '@typescript-eslint/triple-slash-reference': 'off',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        {
          ignoreProperties: false,
          ignoreParameters: false,
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },

  ...pluginVue.configs['flat/base'],
  ...pluginVue.configs['flat/essential'],
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['*.vue', '**/*.vue'],
    plugins: {
      // '@typescript-eslint': pluginTsEslint,
      prettier: pluginPrettier,
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        ecmaFeatures: {
          jsx: true,
          modules: true,
          experimentalObjectRestSpread: true,
        },
      },
    },
    rules: {
      curly: ['error', 'all'],
      'no-undef': 'off',
      'no-unsafe-optional-chaining': ['error'],

      '@typescript-eslint/triple-slash-reference': 'off',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        {
          ignoreProperties: false,
          ignoreParameters: false,
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],

      'vue/no-v-model-argument': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-duplicate-attributes': [
        'error',
        {
          allowCoexistClass: true,
          allowCoexistStyle: true,
        },
      ],

      'prettier/prettier': 'off',
      'vue/singleline-html-element-content-newline': [
        'error',
        {
          ignoreWhenNoAttributes: false,
          ignoreWhenEmpty: true,
        },
      ],
    },
  },

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  {
    files: ['**/__tests__/*.{j,t}s?(x)', '**/tests/unit/**/*.spec.{j,t}s?(x)'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
