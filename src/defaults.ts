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
 * MCP definition groups the public server card hides. Groups come from the
 * subdirectory a definition sits in under `server/mcp/tools`, and
 * `mcpServerCard.excludeGroups` extends this list rather than replacing it: a
 * site naming its own private group should not silently start publishing its
 * admin tools.
 */
export const MCP_EXCLUDED_GROUPS = ['admin']

/** Paths owned by the framework or the API, never markdown. */
export const EXCLUDE_PREFIXES = ['/_', '/api/', '/mcp', '/.well-known/']
