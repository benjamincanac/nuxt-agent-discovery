import { useNitroApp } from 'nitropack/runtime'

/**
 * The other shape of a hand-written section: links pointing at data rather
 * than at pages, which is what a site listing its `openapi.json`, its API
 * endpoints and its repository ends up with. That site named no documentation,
 * so `llms-full.txt` still renders the whole site for it.
 *
 * `llms.sections` is build-time config, so calling the hook is the only way to
 * put a second section shape in front of the bridge without a second fixture.
 * The document is built exactly the way `/llms-full.txt` builds its own.
 */
export default defineEventHandler(async (event) => {
  const contents: string[] = []

  await useNitroApp().hooks.callHook('llms:generate:full' as never, event as never, {
    domain: 'https://handwritten.example.com',
    sections: [{
      title: 'API',
      links: [
        { title: 'OpenAPI', href: '/openapi.json' },
        { title: 'Repository', href: 'https://github.com/nuxt/nuxt' }
      ]
    }]
  } as never, contents as never)

  return contents.join('\n\n')
})
