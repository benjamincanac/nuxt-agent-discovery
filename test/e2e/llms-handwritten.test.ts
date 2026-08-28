import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * A site that curates `llms.sections` by hand, which is the shape the bridge
 * used to get wrong: every section carries its own links, so the adapter
 * resolves none of them, and `llms-full.txt` answered that by rendering every
 * route it could find. The index stayed curated while the full document held
 * the whole site, `/private/hidden` included.
 *
 * The adapter here lists all four pages, so a document coming out short is
 * curation rather than an adapter with nothing to say: `/sitemap.md` below is
 * the control.
 */
const SITE_URL = 'https://handwritten.example.com'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/llms-handwritten', import.meta.url)),
  build: true,
  server: true,
  setupTimeout: 300000
})

describe('llms.txt', () => {
  it('lists the hand-written links, rewritten to raw twins, and nothing else', async () => {
    const body = await (await fetch('/llms.txt')).text()

    // The landing page the module adds, `nuxt-llms`'s own pointer at the full
    // document, then the one link the site wrote. `/docs/beta` and
    // `/private/hidden` are pages the adapter knows and the site did not link.
    expect(body.split('\n').filter(line => line.startsWith('- '))).toEqual([
      `- [Handwritten](${SITE_URL}/raw/index.md)`,
      `- [Handwritten](${SITE_URL}/llms-full.txt): The curated documentation.`,
      `- [Alpha](${SITE_URL}/raw/docs/alpha.md): The documented page.`
    ])
  })
})

describe('llms-full.txt', () => {
  it('renders no page the index does not link', async () => {
    const body = await (await fetch('/llms-full.txt')).text()

    expect(body).not.toContain('# Beta')
    expect(body).not.toContain('A page the sections leave out.')
    expect(body).not.toContain('# Hidden')
    expect(body).not.toContain('kept out of the documentation on purpose')
  })

  it('comes out empty when every section is hand-written', async () => {
    const response = await fetch('/llms-full.txt')

    expect(response.status).toBe(200)
    // A hand-written link is not a selector the adapter can resolve back to a
    // page, so the sections name nothing to render. Empty is what agrees with
    // the index: the alternative was the whole site, which agreed with nothing.
    expect((await response.text()).trim()).toBe('')
  })

  it('still renders the whole site for sections linking only data', async () => {
    // `/llms-datalinks.txt` runs the same hook over sections whose links are an
    // `openapi.json` and a repository. Those name no documentation, so the
    // fallback has to stay: it is the only thing such a site's full document
    // would ever hold. `llms.txt` keys its own fallback on the same predicate,
    // so the two documents cannot disagree about it.
    const body = await (await fetch('/llms-datalinks.txt')).text()

    expect(body).toContain('# Alpha')
    expect(body).toContain('# Beta')
    expect(body).toContain('# Hidden')
  })
})

describe('the pages the documents leave out', () => {
  it('keeps them in the adapter, and in `/sitemap.md`', async () => {
    const body = await (await fetch('/sitemap.md')).text()

    expect(body).toContain(`[Alpha](${SITE_URL}/raw/docs/alpha.md)`)
    expect(body).toContain(`[Beta](${SITE_URL}/raw/docs/beta.md)`)
    expect(body).toContain(`[Hidden](${SITE_URL}/raw/private/hidden.md)`)
  })

  it('still serves their raw markdown', async () => {
    const response = await fetch('/raw/docs/beta.md')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# Beta')
  })
})
