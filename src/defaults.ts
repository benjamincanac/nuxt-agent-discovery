/**
 * User agents served markdown without an explicit `Accept` header.
 *
 * One list for every surface: the deploy-preset rewrite matchers, the Nitro
 * middleware, the error handler and the `robots.txt` AI policy. Re-check
 * quarterly against https://github.com/ai-robots-txt/ai.robots.txt — new agent
 * UAs appear frequently and stale entries cost nothing to drop.
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
 * MCP definition groups the public server card hides.
 *
 * Defined in `runtime/shared/defaults.ts`, since the card route applies it
 * again per request rather than trusting the merged runtime config, and
 * re-exported here so the defaults still read as one list.
 */
export { MCP_EXCLUDED_GROUPS } from './runtime/shared/defaults'

/** Paths owned by the framework or the API, never markdown. */
export const EXCLUDE_PREFIXES = ['/_', '/api/', '/mcp', '/.well-known/']
