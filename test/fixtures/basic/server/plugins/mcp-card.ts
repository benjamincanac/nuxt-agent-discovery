export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', (_event, card) => {
    card.tools = [{ name: 'search', description: 'Search the fixture.' }]
  })
})
