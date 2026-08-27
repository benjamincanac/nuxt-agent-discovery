import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { useAgentDiscoveryConfig } from './agent-discovery'
import type { AgentRoute, NegotiationConfig } from '../../shared/types'

/**
 * The discovery layer as OpenAPI fragments, for sites that publish an
 * `openapi.json`.
 *
 * These paths are identical across every site running this module by
 * construction: they all negotiate the same way, serve the same raw twins and
 * advertise the same documents. Hand-writing them means restating the route
 * config in a second place, where it drifts the moment `routes` or
 * `rawPrefix` changes.
 *
 * Returns fragments rather than a whole document. A site owns its `info`,
 * `servers` and its own endpoints, and merges these in:
 *
 * ```ts
 * const discovery = agentDiscoveryOpenApi(event, { paths: myPaths })
 * return {
 *   openapi: '3.1.0',
 *   info: { ... },
 *   tags: [...discovery.tags, ...myTags],
 *   paths: { ...discovery.paths, ...myPaths },
 *   components: {
 *     headers: discovery.components.headers,
 *     responses: discovery.components.responses,
 *     schemas: { ...discovery.components.schemas, ...mySchemas }
 *   }
 * }
 * ```
 *
 * Spreading the site's own values last means any path here can be replaced
 * with a richer, site-specific description.
 *
 * Pass the `paths` being merged in and every `operationId` in them is claimed
 * before one is derived here, so a site's own operation keeps its name and the
 * generated one takes a numeric suffix. Without it the two namespaces are
 * decided independently and a duplicate is only caught by a linter, if the
 * site runs one. `reserved` does the same for a document assembled where this
 * call cannot see it.
 *
 * The namespace, for a site picking names by hand:
 *
 * - a page pattern gets `get<PascalRoute>`, its raw twin
 *   `get<PascalRoute>Markdown`. `/` is `getHomepage`/`getHomepageMarkdown`,
 *   a wildcard pattern ends in `Page`, so `/docs/**` is `getDocsPage`
 * - the discovery documents get `getSitemapMarkdown`, `getSitemapXml`,
 *   `getLlmsTxt`, `getLlmsFullTxt`, `getApiCatalog`, `getMcpServerCard`,
 *   `getSkillsIndex` and `callMcpServer`, each only when the site serves it
 */

type Json = Record<string, unknown>

/** Options for {@link agentDiscoveryOpenApi}. */
export interface AgentOpenApiOptions {
  /**
   * The `paths` object these fragments are being merged into. Every
   * `operationId` in it is claimed first, so a generated id never lands on a
   * name the site is already using.
   */
  paths?: Record<string, unknown>
  /**
   * Operation ids to claim without a `paths` object to read them from, for a
   * document assembled somewhere this call cannot see.
   */
  reserved?: string[]
}

/** The fixed fields of an OpenAPI path item that carry an operation. */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/**
 * Operation ids of the discovery documents, by the registered link each one
 * follows.
 *
 * Claimed ahead of every route-derived id, so a page pattern deriving the same
 * name takes the suffix instead of these moving. A generated client calls
 * `getSitemapMarkdown()` on every site running this module, and that should not
 * change because one of them happens to configure a `/sitemap` page.
 */
const DISCOVERY_OPERATIONS: Record<string, string> = {
  '/sitemap.md': 'getSitemapMarkdown',
  '/sitemap.xml': 'getSitemapXml',
  '/llms.txt': 'getLlmsTxt',
  '/llms-full.txt': 'getLlmsFullTxt',
  '/.well-known/api-catalog': 'getApiCatalog',
  '/.well-known/mcp/server-card.json': 'getMcpServerCard',
  '/.well-known/skills/index.json': 'getSkillsIndex'
}

/** The MCP endpoint, which follows the server card rather than a link of its own. */
const MCP_OPERATION = 'callMcpServer'

const NEGOTIATION = 'Every page is available as Markdown. Append `.md` to the URL, or send `Accept: text/markdown` on the HTML URL. Known AI agent user agents receive Markdown by default.'

/** Turns a route pattern into an OpenAPI path template: `**` becomes a `{path}` parameter, a single `*` a `{segment}` one. */
function toTemplate(pattern: string): { path: string, params: string[] } {
  const params: string[] = []
  const path = pattern.replace(/\*\*|\*/g, (match) => {
    const base = match === '**' ? 'path' : 'segment'
    const name = params.filter(param => param.startsWith(base)).length ? `${base}${params.length + 1}` : base
    params.push(name)
    return `{${name}}`
  })
  return { path, params }
}

/** `docs-api` → `DocsApi`, `3.x` → `3X`. */
function pascalCase(segment: string): string {
  return segment
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1))
    .join('')
}

/**
 * The `operationId` of a route pattern, which client generators turn into a
 * method name. Static segments are PascalCased, `*` becomes `Segment` and an
 * inner `**` becomes `Path`; a wildcard pattern ends in `Page`, with the
 * trailing `**` left implicit:
 *
 * `/` → `getHomepage`, `/about` → `getAbout`, `/docs/**` → `getDocsPage`, and a
 * locale wildcard in front of that last one → `getSegmentDocsPage`.
 *
 * Derived from the pattern alone, so an id only moves when that pattern does.
 */
function routeOperation(pattern: string): string {
  if (pattern === '/') {
    return 'Homepage'
  }
  const segments = pattern.split('/').filter(Boolean)
  const wildcard = pattern.includes('*')
  if (segments[segments.length - 1] === '**') {
    segments.pop()
  }
  const name = segments
    .map(segment => segment === '**' ? 'Path' : segment === '*' ? 'Segment' : pascalCase(segment))
    .join('')
  return wildcard ? `${name}Page` : name
}

/**
 * Every `operationId` in a caller's `paths` object.
 *
 * Only the fixed method fields are read: a path item also carries `summary`,
 * `parameters` and `servers`, none of which name an operation.
 */
function operationIds(paths: Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const item of Object.values(paths)) {
    if (!item || typeof item !== 'object') {
      continue
    }
    for (const method of METHODS) {
      const operation = (item as Json)[method] as Json | undefined
      const id = operation?.operationId
      if (typeof id === 'string') {
        ids.push(id)
      }
    }
  }
  return ids
}

/**
 * Two patterns can derive the same name (`/docs/api` and `/docs-api`), a
 * pattern can derive a discovery document's name (`/sitemap` derives
 * `getSitemapMarkdown`), and either can land on one the caller is already
 * using. Whichever claims a name first keeps it; the next one along takes a
 * numeric suffix.
 *
 * The order is caller first, then the discovery documents, then the routes in
 * the site's own config order, which makes the result stable for a given
 * config.
 */
function claim(taken: Set<string>, name: string): string {
  let candidate = name
  for (let index = 2; taken.has(candidate); index++) {
    candidate = `${name}${index}`
  }
  taken.add(candidate)
  return candidate
}

function pathParameters(params: string[], pattern: string): Json[] {
  return params.map(name => ({
    name,
    in: 'path',
    required: true,
    description: name.startsWith('path')
      ? `Page path below \`${pattern.split('*')[0]}\`, may contain slashes.`
      : 'A single path segment.',
    schema: { type: 'string' }
  }))
}

/**
 * A markdown response. Carries `Vary` like the negotiated page does: these URLs
 * serve markdown to every client, but they are where a negotiated page sends
 * one, so the header is on them too and the document has to say so.
 */
function markdown(description: string): Json {
  return {
    description,
    headers: { Vary: { $ref: '#/components/headers/Vary' } },
    content: { 'text/markdown': { schema: { type: 'string' } } }
  }
}

function text(description: string): Json {
  return { description, content: { 'text/plain': { schema: { type: 'string' } } } }
}

function negotiatedPage(config: NegotiationConfig, route: AgentRoute, operationId: string): Json {
  const { path, params } = toTemplate(route.path)
  const label = route.path === '/' ? 'Homepage' : `Page under \`${route.path}\``
  return {
    [path]: {
      get: {
        tags: ['Documentation'],
        operationId,
        summary: label,
        description: `Returns HTML by default, Markdown when negotiated. ${NEGOTIATION}`,
        ...(params.length ? { parameters: pathParameters(params, route.path) } : {}),
        responses: {
          200: {
            description: `${label}, as HTML or Markdown.`,
            headers: { Vary: { $ref: '#/components/headers/Vary' } },
            content: {
              'text/html': { schema: { type: 'string' } },
              'text/markdown': { schema: { type: 'string' } }
            }
          },
          404: { $ref: '#/components/responses/NotFoundMarkdown' },
          // Only the pages can refuse every representation, and only where the
          // site turned that on. Left out otherwise rather than documented as
          // a status nothing returns.
          ...(config.notAcceptable ? { 406: { $ref: '#/components/responses/NotAcceptable' } } : {})
        }
      }
    }
  }
}

function rawPage(config: NegotiationConfig, route: AgentRoute, operationId: string): Json {
  const raw = route.raw && !route.path.includes('*')
    ? { path: route.raw, params: [] as string[] }
    : (() => {
        const { path, params } = toTemplate(route.path)
        return { path: `${config.rawPrefix}${path === '/' ? '/index' : path}.md`, params }
      })()

  return {
    [raw.path]: {
      get: {
        tags: ['Documentation'],
        operationId,
        summary: route.path === '/' ? 'Homepage as Markdown' : `Markdown of a page under \`${route.path}\``,
        description: 'Markdown source, with YAML frontmatter (`title`, `description`, `canonical_url`).',
        ...(raw.params.length ? { parameters: pathParameters(raw.params, route.path) } : {}),
        responses: {
          200: markdown('The page as Markdown, with YAML frontmatter.'),
          404: { $ref: '#/components/responses/NotFoundMarkdown' }
        }
      }
    }
  }
}

function discoveryDocument(operationId: string, summary: string, description: string, response: Json): Json {
  return { get: { tags: ['Discovery'], operationId, summary, description, responses: { 200: response } } }
}

export function agentDiscoveryOpenApi(event: H3Event, options: AgentOpenApiOptions = {}): { tags: Json[], paths: Json, components: { headers: Json, responses: Json, schemas: Json } } {
  const config = useAgentDiscoveryConfig(event)
  const has = (href: string) => config.links.some(link => link.href === href)

  // Only a same-origin path, since `paths` is relative to `servers`. A card
  // pointing at an endpoint on another host has nothing to describe here.
  const mcp = useRuntimeConfig(event).agentDiscoveryMcp as { endpoint?: string } | undefined
  const mcpEndpoint = mcp?.endpoint?.startsWith('/') ? mcp.endpoint : undefined

  // The caller's names first, so nothing generated here can take one of them.
  // Then the discovery documents, whose ids are the same on every site running
  // this module and should not move. The route-derived ids come last and take
  // the suffix on a clash.
  const taken = new Set<string>([
    ...(options.reserved || []),
    ...(options.paths ? operationIds(options.paths) : [])
  ])
  const discovery: Record<string, string> = {}
  for (const [href, id] of Object.entries(DISCOVERY_OPERATIONS)) {
    if (has(href)) {
      discovery[href] = claim(taken, id)
    }
  }
  const mcpOperation = mcpEndpoint ? claim(taken, MCP_OPERATION) : undefined

  const paths: Json = {}
  for (const route of config.routes) {
    const operation = routeOperation(route.path)
    Object.assign(
      paths,
      negotiatedPage(config, route, claim(taken, `get${operation}`)),
      rawPage(config, route, claim(taken, `get${operation}Markdown`))
    )
  }

  if (has('/sitemap.md')) {
    paths['/sitemap.md'] = discoveryDocument(
      discovery['/sitemap.md']!,
      'Markdown sitemap',
      'Every page, grouped into sections, linking to the Markdown URLs.',
      markdown('Markdown index of every page.')
    )
  }
  if (has('/sitemap.xml')) {
    paths['/sitemap.xml'] = discoveryDocument(
      discovery['/sitemap.xml']!,
      'XML sitemap',
      'Every indexable page, in the sitemaps.org XML format.',
      { description: 'Sitemap in the sitemaps.org XML format.', content: { 'application/xml': { schema: { type: 'string' } } } }
    )
  }
  if (has('/llms.txt')) {
    paths['/llms.txt'] = discoveryDocument(
      discovery['/llms.txt']!,
      'llms.txt index',
      'Index of the documentation for LLMs, following the llms.txt convention.',
      text('Markdown index.')
    )
  }
  if (has('/llms-full.txt')) {
    paths['/llms-full.txt'] = discoveryDocument(
      discovery['/llms-full.txt']!,
      'Full documentation for LLMs',
      'Every documentation page concatenated as Markdown. Large response.',
      text('Full documentation as Markdown.')
    )
  }
  if (has('/.well-known/api-catalog')) {
    paths['/.well-known/api-catalog'] = discoveryDocument(
      discovery['/.well-known/api-catalog']!,
      'API catalog (RFC 9727)',
      'Linkset pointing at the documents this site publishes for agents.',
      { description: 'Linkset document.', content: { 'application/linkset+json': { schema: { $ref: '#/components/schemas/Linkset' } } } }
    )
  }
  // The MCP endpoint itself, alongside the card that describes it. Not a route
  // this module serves, the same as `/sitemap.xml` and the two llms documents
  // above: what earns a path here is being in the discovery registry, not who
  // answers it. Leaving this one out is what made every adopter hand-write the
  // same JSON-RPC block.
  if (mcpEndpoint) {
    paths[mcpEndpoint] = {
      post: {
        tags: ['Discovery'],
        operationId: mcpOperation!,
        summary: 'MCP endpoint',
        description: 'Model Context Protocol endpoint (streamable HTTP transport), speaking JSON-RPC 2.0. Use an MCP client rather than calling it directly.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', description: 'JSON-RPC 2.0 request.' } } }
        },
        responses: {
          200: {
            description: 'JSON-RPC 2.0 response, or an SSE stream of them.',
            content: {
              'application/json': { schema: { type: 'object', description: 'JSON-RPC 2.0 response.' } },
              'text/event-stream': { schema: { type: 'string' } }
            }
          }
        }
      }
    }
  }
  if (has('/.well-known/mcp/server-card.json')) {
    paths['/.well-known/mcp/server-card.json'] = discoveryDocument(
      discovery['/.well-known/mcp/server-card.json']!,
      'MCP server card',
      'Describes the MCP endpoint, its capabilities and what it exposes.',
      { description: 'MCP server card, following the schema it declares in `$schema`.', content: { 'application/json': { schema: { type: 'object' } } } }
    )
  }
  if (has('/.well-known/skills/index.json')) {
    paths['/.well-known/skills/index.json'] = discoveryDocument(
      discovery['/.well-known/skills/index.json']!,
      'Agent skills index',
      'Lists the agent skills published by this site and the files each one is made of, served under `/.well-known/skills/{name}/`.',
      { description: 'Skills index.', content: { 'application/json': { schema: { $ref: '#/components/schemas/SkillsIndex' } } } }
    )
  }

  const schemas: Json = {}
  if (has('/.well-known/api-catalog')) {
    schemas.Linkset = {
      type: 'object',
      description: 'RFC 9727 linkset. Each entry anchors a resource and points at its description and documentation.',
      properties: {
        linkset: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              'anchor': { type: 'string', format: 'uri' },
              'service-desc': { $ref: '#/components/schemas/LinksetTargets' },
              'service-doc': { $ref: '#/components/schemas/LinksetTargets' }
            },
            required: ['anchor']
          }
        }
      },
      required: ['linkset']
    }
    schemas.LinksetTargets = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          href: { type: 'string', format: 'uri' },
          type: { type: 'string', description: 'Media type of the target.' }
        },
        required: ['href']
      }
    }
  }
  if (has('/.well-known/skills/index.json')) {
    schemas.SkillsIndex = {
      type: 'object',
      description: 'Agent skills published by this site, served under `/.well-known/skills/{name}/`.',
      properties: {
        skills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              files: { type: 'array', description: 'Paths relative to the skill directory.', items: { type: 'string' } }
            },
            required: ['name', 'description', 'files']
          }
        }
      },
      required: ['skills']
    }
  }

  return {
    tags: [
      { name: 'Documentation', description: 'Pages as Markdown.' },
      { name: 'Discovery', description: 'Machine-readable indexes and agent metadata.' }
    ],
    paths,
    components: {
      headers: {
        Vary: {
          description: 'Always includes `Accept` and `User-Agent`. The page depends on both, and its Markdown representation carries the header too, since that is where a negotiated request is sent.',
          schema: { type: 'string' }
        }
      },
      responses: {
        NotFoundMarkdown: {
          description: 'The page does not exist. The body is a short Markdown document linking to the entry points an agent can recover from.',
          content: { 'text/markdown': { schema: { type: 'string' } } }
        },
        // The body follows the same rules every other error does, so a browser
        // `fetch()` keeps the JSON it was written against while an agent or a
        // command-line client gets the Markdown one.
        ...(config.notAcceptable
          ? {
              NotAcceptable: {
                description: 'The `Accept` header allows neither representation of the page. The body names the two that exist.',
                headers: { Vary: { $ref: '#/components/headers/Vary' } },
                content: {
                  'text/markdown': { schema: { type: 'string' } },
                  'application/json': { schema: { type: 'object' } }
                }
              }
            }
          : {})
      },
      schemas
    }
  }
}
