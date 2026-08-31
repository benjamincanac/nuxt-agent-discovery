import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * Narrowed `routes` under a curated section. The section names a page outside
 * the negotiated patterns, which is its call: `llms.txt` used to read that
 * link as "not a page", decide no section named documentation, and append the
 * whole site after the curation, while `llms-full.txt` rendered only the
 * curated page, so the two documents disagreed. A page counts as a page by
 * exclusion and extension now, not by `routes`.
 */
const SITE_URL = 'https://narrow.example.com'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/llms-narrow', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('llms.txt', () => {
  it('keeps the curated section and skips the whole-site fallback', async () => {
    const body = await (await fetch('/llms.txt')).text()

    // The curated link stays a plain page URL: `/guide/**` is not negotiated,
    // so it has no raw twin to rewrite to.
    expect(body).toContain(`- [Intro](${SITE_URL}/guide/intro): A page outside \`routes\`.`)
    expect(body).not.toContain('Alpha')
  })
})

describe('llms-full.txt', () => {
  it('renders the page the curated link names, and nothing else', async () => {
    const body = await (await fetch('/llms-full.txt')).text()

    expect(body).toContain('# Intro')
    expect(body).not.toContain('# Alpha')
  })
})
