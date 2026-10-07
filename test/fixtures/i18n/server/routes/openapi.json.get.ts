import { agentDiscoveryOpenApi } from '#agent-discovery'

export default defineEventHandler(() => {
  const discovery = agentDiscoveryOpenApi()

  return {
    openapi: '3.1.0',
    info: { title: 'i18n', version: '0.0.0' },
    tags: discovery.tags,
    paths: discovery.paths,
    components: discovery.components
  }
})
