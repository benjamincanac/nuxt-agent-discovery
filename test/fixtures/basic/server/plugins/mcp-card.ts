export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:mcp-server-card', (_event, card) => {
    // Appends. The module already listed what the MCP server exposes, so a
    // hook that assigned here would drop the real tools on the floor.
    card.tools = [
      ...(card.tools as unknown[] ?? []),
      { name: 'external', description: 'A tool the site knows about and the toolkit does not.' }
    ]
  })
})
