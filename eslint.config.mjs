import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: {
      commaDangle: 'never',
      braceStyle: '1tbs'
    }
  }
}).overrideRules({
  'vue/multi-word-component-names': 'off',
  // `interface RuntimeConfig extends AgentDiscoveryRuntimeConfig {}` is how a
  // module merges its own types into `@nuxt/schema`.
  '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }]
})
