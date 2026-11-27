import { defineEventHandler, setResponseHeaders } from 'h3'
import { mcpServerCard } from '../utils/mcp-server-card'
import { assertDocumentMethod } from '../utils/server.legacy'

/** MCP server card, on Nitro 2. The card is built in `mcpServerCard()`. */
export default defineEventHandler(async (event) => {
  assertDocumentMethod(event)
  const { body, headers } = await mcpServerCard(event)
  setResponseHeaders(event, headers)
  return body
})
