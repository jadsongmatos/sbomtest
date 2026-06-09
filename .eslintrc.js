module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: [
    'eslint:recommended',
    'standard',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.ts'],
        moduleDirectory: ['node_modules', 'src/lib/'],
      },
    },
  },
  rules: {
    'indent': ['error', 2, { SwitchCase: 1 }],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'semi': ['error', 'always'],
    'comma-dangle': ['error', 'always-multiline'],
    'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
    'quote-props': ['error', 'as-needed', { keywords: true, numbers: true }],
    'camelcase': ['error', { allow: ['^repo_url$', '^_'] }],
    'import/first': 'error',
    'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],

    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-debugger': 'error',
    'no-var': 'error',
    'prefer-const': 'error',

    'handle-callback-err': 'error',
    'no-path-concat': 'error',
    'no-process-env': 'off',
    'no-process-exit': 'off',
    'no-sync': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],

    'id-length': [
      'error',
      {
        exceptions: ['_', 'i', 'j', 'x', 'y', 'z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w'],
        min: 2,
      },
    ],
    'no-magic-numbers': 'off',
    'max-depth': 'off',
    'max-params': 'off',
    'max-statements': 'off',

    'curly': ['error', 'all'],
    'eqeqeq': ['error', 'smart'],
    'no-else-return': ['error', { allowElseIf: false }],
    'no-param-reassign': ['error', { props: false }],
    'prefer-template': 'error',

    'spaced-comment': ['error', 'always', {
      markers: ['/', '!', '/**', '*', '//', '/*'],
    }],

    'no-undef': 'off',
    '@typescript-eslint/no-undef': 'off',
  },
  overrides: [
    {
      files: ['*.js'],
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
    {
      files: ['tests/**/*.ts'],
      rules: {
        'n/no-callback-literal': 'off',
      },
    },
  ],
};
