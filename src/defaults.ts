/**
 * User agents served markdown without an explicit `Accept` header.
 *
 * One list for the rewrite matchers, the middleware, the error handler and the
 * `robots.txt` AI policy. Re-check against https://github.com/ai-robots-txt/ai.robots.txt.
 *
 * Matched as a substring of the incoming `User-Agent`, so a token covers every
 * version and variant spelled around it: `AI2Bot` answers `Ai2Bot-Dolma`,
 * `MistralAI-User` answers `MistralAI-User/1.0`, `Diffbot` answers `Diffbot-User`.
 *
 * Bare `Applebot` is deliberately absent. It feeds Siri and Spotlight results,
 * so serving it markdown changes what a search surface shows rather than what an
 * agent reads; `Applebot-Extended`, the AI control, is the one that belongs here.
 */
export const AGENT_USER_AGENTS = [
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
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
  'Perplexity-User',
  'MistralAI-User',
  'DuckAssistBot',
  'YouBot',
  'DeepSeekBot',
  'Amazonbot',
  'cohere-ai',
  'AI2Bot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'Diffbot',
  'FirecrawlAgent'
]

/**
 * MCP definition groups the public server card hides. Defined in the shared
 * defaults, which the card route applies again per request.
 */
export { MCP_EXCLUDED_GROUPS } from './runtime/shared/defaults'

/** Paths owned by the framework or the API, never markdown. */
export const EXCLUDE_PREFIXES = ['/_', '/api/', '/mcp', '/.well-known/']
