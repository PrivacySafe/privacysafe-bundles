module.exports = {
  plugins: ['stylelint-scss'],
  extends: ['stylelint-config-standard', 'stylelint-config-recommended-scss', 'stylelint-config-recommended-vue'],
  ignoreFiles: ['/app/assets/**/*.css'],

  rules: {
    'length-zero-no-unit': null,
    'value-keyword-case': null,
    'at-rule-empty-line-before': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'no-empty-source': null,
    'no-descending-specificity': null,
    'color-function-notation': null,
    'selector-class-pattern': null,
    'alpha-value-notation': 'number',
    'import-notation': 'string',
    'media-feature-name-no-unknown': [
      true,
      {
        ignoreMediaFeatureNames: ['/^prefers-/'],
      },
    ],
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'include',
          'function',
          'return',
          'mixin',
          'if',
          'else',
          'for',
          'extend',
          'each',
          'content',
          'use',
          'font-feature-values',
          'character-variant',
          'styleset',
        ],
      },
    ],
    'selector-pseudo-class-no-unknown': [
      true,
      {
        ignorePseudoClasses: ['global', 'local', 'export'],
      },
    ],
    'property-no-unknown': [
      true,
      {
        ignoreSelectors: ['/.*Inter.*/'],
        ignoreAtRules: ['font-feature-values', 'character-variant', 'styleset'],
      },
    ],
    'declaration-property-value-keyword-no-deprecated': [true, { ignoreKeywords: ['break-word'] }],
  },
};
