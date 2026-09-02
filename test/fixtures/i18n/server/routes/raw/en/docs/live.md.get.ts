/**
 * A twin the site serves itself, reading data the build cannot freeze. The
 * page behind it is matched by the wildcard route, so no build-time list of
 * twins could have skipped it: the module reads this file as the pattern
 * Nitro registers for it, and the page's own prerender hint leaves it alone.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return `# Live\n\nRendered at ${Date.now()}.\n`
})
