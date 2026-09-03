import { getAgentDocument } from '#agent-discovery'

/**
 * `getAgentDocument()` over HTTP, so a test can hold the served documents
 * against the bytes the in-process resolver returns for the same route.
 */
export default defineEventHandler(async (event) => {
  const document = await getAgentDocument(event, String(getQuery(event).route || '/'))
  if (!document || 'redirect' in document) {
    throw createError({ statusCode: 404, statusMessage: 'Page Not Found' })
  }
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return document.markdown
})
