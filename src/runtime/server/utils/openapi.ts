import type { H3Event } from 'h3'
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
 * const discovery = agentDiscoveryOpenApi(event)
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
 */

type Json = Record<string, unknown>

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

function markdown(description: string): Json {
  return { description, content: { 'text/markdown': { schema: { type: 'string' } } } }
}

function text(description: string): Json {
  return { description, content: { 'text/plain': { schema: { type: 'string' } } } }
}

function negotiatedPage(route: AgentRoute): Json {
  const { path, params } = toTemplate(route.path)
  const label = route.path === '/' ? 'Homepage' : `Page under \`${route.path}\``
  return {
    [path]: {
      get: {
        tags: ['Documentation'],
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
          404: { $ref: '#/components/responses/NotFoundMarkdown' }
        }
      }
    }
  }
}

function rawPage(config: NegotiationConfig, route: AgentRoute): Json {
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

function discoveryDocument(summary: string, description: string, response: Json): Json {
  return { get: { tags: ['Discovery'], summary, description, responses: { 200: response } } }
}

export function agentDiscoveryOpenApi(event: H3Event): { tags: Json[], paths: Json, components: Json } {
  const config = useAgentDiscoveryConfig(event)
  const has = (href: string) => config.links.some(link => link.href === href)

  const paths: Json = {}
  for (const route of config.routes) {
    Object.assign(paths, negotiatedPage(route), rawPage(config, route))
  }

  if (has('/sitemap.md')) {
    paths['/sitemap.md'] = discoveryDocument(
      'Markdown sitemap',
      'Every page, grouped into sections, linking to the Markdown URLs.',
      markdown('Markdown index of every page.')
    )
  }
  if (has('/sitemap.xml')) {
    paths['/sitemap.xml'] = discoveryDocument(
      'XML sitemap',
      'Every indexable page, in the sitemaps.org XML format.',
      { description: 'Sitemap in the sitemaps.org XML format.', content: { 'application/xml': { schema: { type: 'string' } } } }
    )
  }
  if (has('/llms.txt')) {
    paths['/llms.txt'] = discoveryDocument(
      'llms.txt index',
      'Index of the documentation for LLMs, following the llms.txt convention.',
      text('Markdown index.')
    )
  }
  if (has('/llms-full.txt')) {
    paths['/llms-full.txt'] = discoveryDocument(
      'Full documentation for LLMs',
      'Every documentation page concatenated as Markdown. Large response.',
      text('Full documentation as Markdown.')
    )
  }
  if (has('/.well-known/api-catalog')) {
    paths['/.well-known/api-catalog'] = discoveryDocument(
      'API catalog (RFC 9727)',
      'Linkset pointing at the documents this site publishes for agents.',
      { description: 'Linkset document.', content: { 'application/linkset+json': { schema: { $ref: '#/components/schemas/Linkset' } } } }
    )
  }
  if (has('/.well-known/mcp/server-card.json')) {
    paths['/.well-known/mcp/server-card.json'] = discoveryDocument(
      'MCP server card',
      'Describes the MCP endpoint, its capabilities and what it exposes.',
      { description: 'MCP server card, following the schema it declares in `$schema`.', content: { 'application/json': { schema: { type: 'object' } } } }
    )
  }
  if (has('/.well-known/skills/index.json')) {
    paths['/.well-known/skills/index.json'] = discoveryDocument(
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
          description: 'Always includes `Accept` and `User-Agent`, since the representation depends on both.',
          schema: { type: 'string' }
        }
      },
      responses: {
        NotFoundMarkdown: {
          description: 'The page does not exist. The body is a short Markdown document linking to the entry points an agent can recover from.',
          content: { 'text/markdown': { schema: { type: 'string' } } }
        }
      },
      schemas
    }
  }
}
