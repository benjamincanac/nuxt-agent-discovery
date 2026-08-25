import { renderAgentResources } from '#agent-discovery'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return renderAgentResources(event)
})
