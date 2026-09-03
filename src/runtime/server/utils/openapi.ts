import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { useAgentDiscoveryConfig } from './agent-discovery'
import { SKILLS_INDEX } from '../../shared/paths'
import type { AgentRoute, NegotiationConfig } from '../../shared/types'

/**
 * The discovery layer as OpenAPI fragments, for sites that publish an
 * `openapi.json`. Derived from the route config, which hand-written paths drift
 * from as soon as `routes` or `rawPrefix` changes.
 *
 * A site owns its `info`, `servers` and its own endpoints, and merges these in,
 * spreading its own values last so it can replace any path here:
 *
 * ```ts
 * const discovery = agentDiscoveryOpenApi(event, { paths: myPaths })
 * return {
 *   openapi: '3.1.0',
 *   info: { ... },
 *   tags: [...discovery.tags, ...myTags],
 *   paths: { ...discovery.paths, ...myPaths },
 *   components: { ...discovery.components, schemas: { ...discovery.components.schemas, ...mySchemas } }
 * }
 * ```
 *
 * Every call builds its fragments from scratch, so what comes back is the
 * caller's to edit in place.
 *
 * Operation ids: a page pattern gets `get<PascalRoute>` and its raw twin
 * `get<PascalRoute>Markdown`, a wildcard pattern ends in `Page`, and each
 * discovery document keeps a fixed id such as `getSitemapMarkdown`. Ids passed
 * in `paths` and `reserved` are claimed first, so a generated one takes a
 * numeric suffix on a clash.
 */

type Json = Record<string, unknown>

/** Options for {@link agentDiscoveryOpenApi}. */
export interface AgentOpenApiOptions {
  /** The `paths` object these fragments are merged into. Every `operationId` in it is claimed first. */
  paths?: Record<string, unknown>
  /** Operation ids to claim without a `paths` object to read them from. */
  reserved?: string[]
}

/** The fixed fields of an OpenAPI path item that carry an operation. */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/**
 * Operation ids of the discovery documents, by registered link. Claimed ahead
 * of every route-derived id: a generated client calls `getSitemapMarkdown()` on
 * every site running this module, so a `/sitemap` page takes the suffix instead.
 */
const DISCOVERY_OPERATIONS: Record<string, string> = {
  '/sitemap.md': 'getSitemapMarkdown',
  '/sitemap.xml': 'getSitemapXml',
  '/llms.txt': 'getLlmsTxt',
  '/llms-full.txt': 'getLlmsFullTxt',
  '/.well-known/api-catalog': 'getApiCatalog',
  '/.well-known/mcp/server-card.json': 'getMcpServerCard',
  [SKILLS_INDEX]: 'getSkillsIndex'
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
 * method name. Static segments are PascalCased, `*` becomes `Segment`, an inner
 * `**` becomes `Path`, and a wildcard pattern ends in `Page` with the trailing
 * `**` implicit: `/` → `Homepage`, `/docs/**` → `DocsPage`.
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

/** Every `operationId` in a caller's `paths` object. Only the fixed method fields name an operation. */
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
 * Whichever name is claimed first keeps it, the next one along takes a numeric
 * suffix. Two patterns can derive the same name (`/docs/api` and `/docs-api`),
 * and either can land on one the caller or a discovery document already uses.
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

/** A markdown response. Carries `Vary` because this is where a negotiated page sends a client. */
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
          // Only where the site turned it on, rather than documenting a status nothing returns.
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

/** A row of {@link DOCUMENTS}: everything about a discovery document that varies between them. */
interface DocumentRow {
  href: string
  summary: string
  description: string
  /** Built per call: the document is the caller's to edit, so no two callers may share an object. */
  response: () => Json
}

/**
 * The discovery documents that are a plain `href` → response mapping, in
 * insertion order. The MCP endpoint is a `post` with a request body and sits
 * between the api catalog and the server card, so `paths` splits this table at
 * {@link MCP_SPLIT} rather than walking it in one pass.
 */
const DOCUMENTS: DocumentRow[] = [
  {
    href: '/sitemap.md',
    summary: 'Markdown sitemap',
    description: 'Every page, grouped into sections, linking to the Markdown URLs.',
    response: () => markdown('Markdown index of every page.')
  },
  {
    href: '/sitemap.xml',
    summary: 'XML sitemap',
    description: 'Every indexable page, in the sitemaps.org XML format.',
    response: () => ({ description: 'Sitemap in the sitemaps.org XML format.', content: { 'application/xml': { schema: { type: 'string' } } } })
  },
  {
    href: '/llms.txt',
    summary: 'llms.txt index',
    description: 'Index of the documentation for LLMs, following the llms.txt convention.',
    response: () => text('Markdown index.')
  },
  {
    href: '/llms-full.txt',
    summary: 'Full documentation for LLMs',
    description: 'Every documentation page concatenated as Markdown. Large response.',
    response: () => text('Full documentation as Markdown.')
  },
  {
    href: '/.well-known/api-catalog',
    summary: 'API catalog (RFC 9727)',
    description: 'Linkset pointing at the documents this site publishes for agents.',
    response: () => ({ description: 'Linkset document.', content: { 'application/linkset+json': { schema: { $ref: '#/components/schemas/Linkset' } } } })
  },
  {
    href: '/.well-known/mcp/server-card.json',
    summary: 'MCP server card',
    description: 'Describes the MCP endpoint, its capabilities and what it exposes.',
    response: () => ({ description: 'MCP server card, following the schema it declares in `$schema`.', content: { 'application/json': { schema: { type: 'object' } } } })
  },
  {
    href: SKILLS_INDEX,
    summary: 'Agent skills index',
    description: 'Lists the agent skills published by this site and the files each one is made of, served under `/.well-known/skills/{name}/`.',
    response: () => ({ description: 'Skills index.', content: { 'application/json': { schema: { $ref: '#/components/schemas/SkillsIndex' } } } })
  }
]

/** Index of the first row in {@link DOCUMENTS} that comes after the MCP endpoint's own path. */
const MCP_SPLIT = DOCUMENTS.findIndex(document => document.href === '/.well-known/mcp/server-card.json')

// Rename or drop that row and the split silently becomes `slice(0, -1)` and
// `slice(-1)`, both valid and both wrong. Cheaper to refuse to load.
if (MCP_SPLIT === -1) {
  throw new Error('nuxt-agent-discovery: no `/.well-known/mcp/server-card.json` row in the OpenAPI document table, so the MCP endpoint has nowhere to sit. Restore the row, or split the table on whatever replaced it.')
}

export function agentDiscoveryOpenApi(event: H3Event, options: AgentOpenApiOptions = {}): { tags: Json[], paths: Json, components: { headers: Json, responses: Json, schemas: Json } } {
  const config = useAgentDiscoveryConfig(event)
  const has = (href: string) => config.links.some(link => link.href === href)

  // Only a same-origin path, since `paths` is relative to `servers`.
  const mcp = useRuntimeConfig(event).agentDiscoveryMcp as { endpoint?: string } | undefined
  const mcpEndpoint = mcp?.endpoint?.startsWith('/') ? mcp.endpoint : undefined

  // The caller's names first, then the discovery documents, whose ids are the
  // same on every site. Route-derived ids come last and take the suffix.
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

  for (const document of DOCUMENTS.slice(0, MCP_SPLIT)) {
    if (has(document.href)) {
      paths[document.href] = discoveryDocument(discovery[document.href]!, document.summary, document.description, document.response())
    }
  }
  // The MCP endpoint itself, alongside the card that describes it. What earns a
  // path here is being in the discovery registry, not who answers it.
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
  for (const document of DOCUMENTS.slice(MCP_SPLIT)) {
    if (has(document.href)) {
      paths[document.href] = discoveryDocument(discovery[document.href]!, document.summary, document.description, document.response())
    }
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
  if (has(SKILLS_INDEX)) {
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
        // The body negotiates like every other error: JSON for a browser
        // `fetch()`, markdown for an agent or a command-line client.
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
