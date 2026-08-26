/**
 * The prose only the site knows. Everything structural on `/raw/index.md`
 * (frontmatter, canonical links, the resources block) comes from the module.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:index', (event, body) => {
    body.push('A Vue landing page, with no content document behind it.')
  })
})
