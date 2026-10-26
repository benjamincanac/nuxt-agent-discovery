import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeConfig } from './nitro.stub'

/**
 * The prerendered-page plugin on a Cloudflare Worker, both Nitro variants. The
 * middleware it runs is stubbed: what is under test is what happens once it
 * leaves the HTML half, which on Cloudflare has no static handler behind it.
 */
const negotiate = vi.hoisted(() => vi.fn())

vi.mock('#agent-discovery-virtual/prerendered', () => ({ default: new Set(['/docs/guide']) }))
vi.mock('../../src/runtime/server/middleware/negotiate.legacy', () => ({ default: negotiate }))
vi.mock('../../src/runtime/server/middleware/negotiate', () => ({ default: negotiate }))
vi.mock('nitro', () => ({ definePlugin: (plugin: unknown) => plugin }))

type Assets = { fetch: (request: Request) => Promise<Response> }
type Handler = (event: unknown) => unknown

/** One request, as each variant's event carries it, with the assets binding when given. */
const variants = [
  {
    name: 'Nitro 2',
    async install(): Promise<Handler> {
      const { default: plugin } = await import('../../src/runtime/server/plugins/prerendered.legacy')
      const stack: { route: string, handler: Handler }[] = [{ route: '/', handler: () => undefined }]
      ;(plugin as unknown as (app: unknown) => void)({ h3App: { stack, use: (route: string, handler: Handler) => stack.push({ route, handler }) } })
      return stack[1]!.handler
    },
    event(path: string, method: string, assets?: Assets) {
      const request = new Request(`https://example.com${path}`, { method })
      return { path, method, handled: false, context: assets ? { cloudflare: { request, env: { ASSETS: assets } } } : {} }
    }
  },
  {
    name: 'Nitro 3',
    async install(): Promise<Handler> {
      const { default: plugin } = await import('../../src/runtime/server/plugins/prerendered')
      const stack: Handler[] = [Object.assign(() => undefined, { __traced__: true })]
      ;(plugin as unknown as (app: unknown) => void)({ h3: { '~middleware': stack } })
      return stack[1]!
    },
    event(path: string, method: string, assets?: Assets) {
      const request = Object.assign(new Request(`https://example.com${path}`, { method }), assets ? { runtime: { cloudflare: { env: { ASSETS: assets } } } } : {})
      return { req: request, url: new URL(request.url), res: { headers: new Headers() }, context: {} }
    }
  }
]

describe.each(variants)('prerendered pages on Cloudflare ($name)', (variant) => {
  let handler: Handler
  beforeEach(async () => {
    setRuntimeConfig({ app: { baseURL: '/' } })
    negotiate.mockReset()
    handler = await variant.install()
  })

  const binding = (response: Response) => {
    const fetch = vi.fn(async (_request: Request) => response)
    return { fetch }
  }

  it('serves the HTML half from the assets binding', async () => {
    const assets = binding(new Response('<main>file</main>', { headers: { etag: '"file"' } }))
    const response = await handler(variant.event('/docs/guide', 'GET', assets)) as Response

    expect(negotiate).toHaveBeenCalledOnce()
    expect(assets.fetch.mock.calls[0]![0].url).toBe('https://example.com/docs/guide')
    expect(response.headers.get('etag')).toBe('"file"')
    expect(await response.text()).toBe('<main>file</main>')
  })

  it('answers what negotiation answered without asking the binding', async () => {
    negotiate.mockResolvedValue('# Guide')
    const assets = binding(new Response('<main>file</main>'))

    expect(await handler(variant.event('/docs/guide', 'GET', assets))).toBe('# Guide')
    expect(assets.fetch).not.toHaveBeenCalled()
  })

  it('falls through to Nitro when the binding has no such file', async () => {
    const assets = binding(new Response(null, { status: 404 }))

    expect(await handler(variant.event('/docs/guide', 'GET', assets))).toBeUndefined()
  })

  it('leaves a host without the binding to its static handler', async () => {
    expect(await handler(variant.event('/docs/guide', 'GET'))).toBeUndefined()
  })

  it('leaves a method the assets cannot answer to Nitro', async () => {
    const assets = binding(new Response('<main>file</main>'))

    expect(await handler(variant.event('/docs/guide', 'POST', assets))).toBeUndefined()
    expect(assets.fetch).not.toHaveBeenCalled()
  })

  it('stays out of the way of a page that was not prerendered', async () => {
    const assets = binding(new Response('<main>file</main>'))

    expect(await handler(variant.event('/docs/other', 'GET', assets))).toBeUndefined()
    expect(negotiate).not.toHaveBeenCalled()
  })
})
