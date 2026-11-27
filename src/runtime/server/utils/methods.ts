/** The methods a document route answers, as its `Allow` header lists them. */
export const DOCUMENT_ALLOW = 'GET, HEAD'

/**
 * Whether a document route answers the method. Nitro registers a route
 * without a method for every one, so anything else has to be refused here.
 * A missing method reads as GET, as `notAcceptable` reads it.
 */
export function isDocumentMethod(method?: string): boolean {
  const upper = (method || 'GET').toUpperCase()
  return upper === 'GET' || upper === 'HEAD'
}
