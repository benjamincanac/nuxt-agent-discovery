/**
 * A sitemap source that deliberately includes a raw markdown twin.
 *
 * Without one the sitemap holds only `/`, and the module's `sitemap:input`
 * filter would have nothing to remove: the assertion that no twin is listed
 * would pass whether or not the filter ran.
 */
export default defineEventHandler(() => [
  { loc: '/docs/getting-started' },
  { loc: '/raw/docs/getting-started.md' },
  { loc: 'https://basic.example.com/raw/index.md' }
])
