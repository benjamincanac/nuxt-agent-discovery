/** The Agent Skills well-known prefix, shared by every surface that names it. */
export const SKILLS_PREFIX = '/.well-known/skills/'

/** The generated skills index document. */
export const SKILLS_INDEX = `${SKILLS_PREFIX}index.json`

/**
 * `app.baseURL` without its trailing slash, so a path appends straight to it.
 * Empty at the root, and for a relative base, which has no fixed prefix.
 */
export function appBase(baseURL?: string): string {
  return !baseURL || baseURL.startsWith('.') ? '' : baseURL.replace(/\/+$/, '')
}

/**
 * Prefixes a root-relative href with `app.baseURL`, leaving others alone.
 * The registry and the raw prefix are written from the app root, like routes.
 */
export function withAppBase(href: string, baseURL?: string): string {
  const base = appBase(baseURL)
  return base && href.startsWith('/') && !href.startsWith('//') ? `${base}${href}` : href
}

/** A pathname below `app.baseURL` as a route, or unchanged when it is not below it. */
export function withoutAppBase(pathname: string, baseURL?: string): string {
  const base = appBase(baseURL)
  return base && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) || '/' : pathname
}
