module.exports = {
  extends: '@antfu',
  rules: {
    'vue/html-self-closing': ['error', {
      html: {
        void: 'always',
        normal: 'never',
        component: 'always',
      },
      svg: 'always',
      math: 'always',
    }],
    '@typescript-eslint/semi': [2, 'always'],
    'vue/max-attributes-per-line': [1, {
      singleline: 3,
      multiline: 1,
    }],
    'curly': [2, 'all'],
    '@typescript-eslint/brace-style': [2, '1tbs', { allowSingleLine: true }],
    'max-statements-per-line': [2, { max: 2 }],
    'no-console': process.env.NODE_ENV === 'production' ? 2 : 1,
    '@typescript-eslint/member-delimiter-style': [2, {
      multiline: {
        delimiter: 'semi',
        requireLast: true,
      },
      singleline: {
        delimiter: 'semi',
        requireLast: false,
      },
      multilineDetection: 'brackets',
    }],
    'sort-imports': 'off',
  },
};
