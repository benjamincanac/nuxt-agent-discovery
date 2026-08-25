import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadNuxt, tryResolveModule } from '@nuxt/kit'

const basic = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

/**
 * `minimark` is the tree format `@nuxt/content` stores and serializes with,
 * not one this module owns: comark sources render through `comark/render` and
 * custom sources bring their own. Stringifying with a copy resolved from this
 * module's dependencies pins a version that can disagree with the content
 * backend's, and a major bump changes the markdown of every page (attribute
 * serialization, code-fence meta, ...). So the module aliases the stringifier
 * to the one `@nuxt/content` itself resolves.
 */
describe('minimark resolution', () => {
  it('aliases `minimark/stringify` to the copy `@nuxt/content` uses', async () => {
    const nuxt = await loadNuxt({ cwd: basic, ready: true, overrides: { _prepare: true } })
    try {
      const alias = nuxt.options.nitro.alias?.['minimark/stringify']
      expect(alias).toBeTruthy()

      const contentEntry = await tryResolveModule('@nuxt/content', nuxt.options.modulesDir)
      const fromContent = await tryResolveModule('minimark/stringify', [contentEntry!])
      expect(alias).toBe(fromContent)

      // ...and specifically not this module's own copy.
      const ours = await tryResolveModule('minimark/stringify', [import.meta.url])
      expect(alias).not.toBe(ours)
    } finally {
      await nuxt.close()
    }
  })
})
