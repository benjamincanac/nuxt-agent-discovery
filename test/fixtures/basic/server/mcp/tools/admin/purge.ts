/** In the `admin` group, so the public server card must leave it out. */
export default defineMcpTool({
  description: 'Purge the fixture.',
  handler: async () => 'purged'
})
