import { useNitroApp } from 'nitropack/runtime'

/**
 * The `llms.txt` side of the data-only section, with one link carrying no
 * extension: `/api/v1/tools` sits under an excluded prefix, so the site has no
 * markdown for it whatever it looks like. Reading the extension alone counted
 * it as a page and left the index with nothing but the API links.
 *
 * `llms.sections` is build-time config, so calling the hook is the only way to
 * put a second section shape in front of the bridge without a second fixture.
 * Only the links are rendered, which is all the assertion reads.
 */
export default defineEventHandler(async (event) => {
  const options = {
    domain: 'https://handwritten.example.com',
    sections: [{
      title: 'API',
      links: [
        { title: 'Tools', href: '/api/v1/tools' },
        { title: 'OpenAPI', href: '/openapi.json' }
      ]
    }]
  }

  await useNitroApp().hooks.callHook('llms:generate' as never, event as never, options as never)

  return options.sections
    .flatMap(section => (section.links || []).map(link => `- [${link.title}](${link.href})`))
    .join('\n')
})
