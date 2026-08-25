import { agentDiscoveryOpenApi } from '#agent-discovery'

export default defineEventHandler((event) => {
  const discovery = agentDiscoveryOpenApi(event)

  return {
    openapi: '3.1.0',
    info: { title: 'Basic', version: '0.0.0' },
    tags: discovery.tags,
    paths: discovery.paths,
    components: discovery.components
  }
})
