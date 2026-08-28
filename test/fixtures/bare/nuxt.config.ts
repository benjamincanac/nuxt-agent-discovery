export default defineNuxtConfig({
  // The empty-`siteUrl` fixture: no `siteUrl`, no `site.url`, no `llms.domain`,
  // so every document that embeds the site URL falls back to the request
  // origin and must answer `Cache-Control: no-cache`.
  modules: ['../../../src/module'],
  devtools: { enabled: false },
  compatibilityDate: '2026-01-01',
  agentDiscovery: {
    source: '~~/server/agent-source'
  }
})
