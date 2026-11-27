import { defineEventHandler } from 'nuxt/server'
import { mcpServerCard } from '../utils/mcp-server-card'
import { assertDocumentMethod } from '../utils/server'

/** MCP server card, on `nuxt/server`. The card is built in `mcpServerCard()`. */
export default defineEventHandler(async (event) => {
  assertDocumentMethod(event)
  const { body, headers } = await mcpServerCard(event)
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
  return body
})
