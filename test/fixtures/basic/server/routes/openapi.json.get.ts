import { agentDiscoveryOpenApi } from '#agent-discovery'

/**
 * The site's own endpoint, named `getPage`, which is what the catch-all route
 * pattern derives for the page itself. Handing the fragments the paths they
 * are merged into is what stops the two namespaces from being decided
 * independently and producing a document no generator accepts.
 */
const paths = {
  '/api/pages.json': {
    get: {
      operationId: 'getPage',
      summary: 'The site\'s own page listing',
      responses: { 200: { description: 'Pages.' } }
    }
  }
}

export default defineEventHandler((event) => {
  const discovery = agentDiscoveryOpenApi(event, { paths })

  return {
    openapi: '3.1.0',
    info: { title: 'Basic', version: '0.0.0' },
    tags: discovery.tags,
    paths: { ...discovery.paths, ...paths },
    components: discovery.components
  }
})
