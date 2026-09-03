/**
 * Link relations accepted for discovery links: the IANA registry
 * (https://www.iana.org/assignments/link-relations) plus the unregistered but
 * universally understood `sitemap`. Extension relations are allowed as absolute
 * URIs, per RFC 8288 § 2.1.2, and anything else fails the build.
 */
const IANA_RELS = new Set([
  'about', 'acl', 'alternate', 'amphtml', 'api-catalog', 'appendix',
  'apple-touch-icon', 'apple-touch-startup-image', 'archives', 'author',
  'blocked-by', 'bookmark', 'c2pa-manifest', 'canonical', 'chapter', 'cite-as',
  'collection', 'compression-dictionary', 'contents', 'convertedfrom',
  'copyright', 'create-form', 'current', 'deprecation', 'describedby',
  'describes', 'disclosure', 'dns-prefetch', 'duplicate', 'edit', 'edit-form',
  'edit-media', 'enclosure', 'external', 'first', 'glossary', 'help', 'hosts',
  'hub', 'ice-server', 'icon', 'index', 'intervalafter', 'intervalbefore',
  'intervalcontains', 'intervaldisjoint', 'intervalduring', 'intervalequals',
  'intervalfinishedby', 'intervalfinishes', 'intervalin', 'intervalmeets',
  'intervalmetby', 'intervaloverlappedby', 'intervaloverlaps',
  'intervalstartedby', 'intervalstarts', 'item', 'last', 'latest-version',
  'license', 'linkset', 'lrdd', 'manifest', 'mask-icon', 'me', 'media-feed',
  'memento', 'micropub', 'modulepreload', 'monitor', 'monitor-group', 'next',
  'next-archive', 'nofollow', 'noopener', 'noreferrer', 'opener',
  'openid2.local_id', 'openid2.provider', 'original', 'p3pv1', 'payment',
  'pingback', 'preconnect', 'predecessor-version', 'prefetch', 'preload',
  'prerender', 'prev', 'prev-archive', 'preview', 'previous', 'privacy-policy',
  'profile', 'publication', 'related', 'restconf', 'replies', 'ruleinput',
  'search', 'section', 'self', 'service', 'service-desc', 'service-doc',
  'service-meta', 'sip-trunking-capability', 'sponsored', 'start', 'status',
  'stylesheet', 'subsection', 'successor-version', 'sunset', 'tag',
  'terms-of-service', 'timegate', 'timemap', 'type', 'ugc', 'up',
  'version-history', 'via', 'webmention', 'working-copy', 'working-copy-of',
  'sitemap'
])

export function isValidRel(rel: string): boolean {
  return IANA_RELS.has(rel) || /^[a-z][a-z0-9+.-]*:/i.test(rel)
}
