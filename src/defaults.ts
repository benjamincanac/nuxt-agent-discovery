/**
 * User agents served markdown without an explicit `Accept` header.
 *
 * One list for the rewrite matchers, the middleware, the error handler and the
 * `robots.txt` AI policy. Re-check against https://github.com/ai-robots-txt/ai.robots.txt.
 */
export const AGENT_USER_AGENTS = [
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'Google-Extended',
  'Google-CloudVertexBot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'PerplexityBot',
  'YouBot',
  'DeepSeekBot',
  'Amazonbot',
  'cohere-ai',
  'AI2Bot',
  'Applebot-Extended',
  'Bytespider'
]

/**
 * MCP definition groups the public server card hides. Defined in the shared
 * defaults, which the card route applies again per request.
 */
export { MCP_EXCLUDED_GROUPS } from './runtime/shared/defaults'

/** Paths owned by the framework or the API, never markdown. */
export const EXCLUDE_PREFIXES = ['/_', '/api/', '/mcp', '/.well-known/']
