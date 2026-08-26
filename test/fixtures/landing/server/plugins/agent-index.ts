/**
 * The title, description and prose only the site knows. Everything structural
 * on `/raw/index.md` (frontmatter, canonical links, the resources block) comes
 * from the module.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:index', (event, index) => {
    // Appended rather than replaced, so the test sees both the `siteName`
    // the module pre-fills and the site's own override.
    index.title = `${index.title}: A Vue Landing Page`
    index.description = 'Metadata that lives in the app, not in a document.'
    index.body.push('A Vue landing page, with no content document behind it.')
  })
})
