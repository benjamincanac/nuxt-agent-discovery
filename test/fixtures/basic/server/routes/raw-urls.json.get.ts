import { rawUrl } from '#agent-discovery'

export default defineEventHandler(event => ({
  page: rawUrl(event, '/docs/getting-started'),
  home: rawUrl(event, '/'),
  query: rawUrl(event, '/docs/getting-started?x=1#y'),
  asset: rawUrl(event, '/openapi.json'),
  external: rawUrl(event, 'https://example.com/docs/x')
}))
