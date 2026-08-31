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
 * Both documents read the same links now: the curated pages are what the full
 * document renders, and a section pointing only at data names no page in
 * either. The adapter here lists all four pages, so a document coming out
 * short is curation rather than an adapter with nothing to say: `/sitemap.md`
 * below is the control.
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
      `- [Alpha](${SITE_URL}/raw/docs/alpha.md): The documented page.`,
      `- [Café](${SITE_URL}/raw/docs/caf%C3%A9.md): The accented page.`,
      // The mixed section keeps only its hand-written link: its selector
      // resolves `/docs/beta`, which neither document may pick up.
      `- [Alpha again](${SITE_URL}/raw/docs/alpha.md): The same page, curated by hand.`
    ])
  })

  it('lists every page when the hand-written links are all data', async () => {
    // `/llms-datalinks-index.txt` runs the same hook over a section linking an
    // API endpoint and an `openapi.json`. Neither has a markdown
    // representation, so the section names no documentation and the listing
    // fallback has to fire. `/api/v1/tools` carries no extension, which is
    // what the old page-link test read it by.
    const body = await (await fetch('/llms-datalinks-index.txt')).text()

    expect(body).toContain(`- [Alpha](${SITE_URL}/raw/docs/alpha.md)`)
    expect(body).toContain(`- [Beta](${SITE_URL}/raw/docs/beta.md)`)
    expect(body).toContain(`- [Hidden](${SITE_URL}/raw/private/hidden.md)`)
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

  it('renders the pages the hand-written links name', async () => {
    const response = await fetch('/llms-full.txt')

    expect(response.status).toBe(200)
    const body = await response.text()

    // The links are the section's documentation, so the full document is the
    // pages behind them. Answering 200 with an empty body was the other half
    // of the bug: `llms.txt` advertised a document holding nothing.
    expect(body.trim()).not.toBe('')
    expect(body).toContain('# Alpha')
    expect(body).toContain('The one page the hand-written section links.')
    // The landing page `llms.txt` advertises as its first link: the full
    // document has to hold the page behind it, mirroring the index hook.
    expect(body).toContain('# Handwritten')
    // The link arrives percent-encoded through `URL.pathname` while the
    // adapter stores the decoded slug, so the route has to be decoded on the
    // way to `get()` or the page silently drops out of the full document.
    expect(body).toContain('# Café')
  })

  it('still renders the whole site for sections linking only data', async () => {
    // `/llms-datalinks.txt` runs the same hook over sections whose links are an
    // `openapi.json`, an API endpoint and a repository. Those name no
    // documentation, so the fallback has to stay: it is the only thing such a
    // site's full document would ever hold. `llms.txt` reads the links the same
    // way, so the two documents cannot disagree about it.
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
