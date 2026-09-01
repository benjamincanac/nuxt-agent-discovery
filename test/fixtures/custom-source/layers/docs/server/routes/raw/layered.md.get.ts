// A layer-owned twin: scanned by Nitro through `extends`, visible in neither
// `serverHandlers` nor the root server dir. The prerender tests in
// `test/unit/module.test.ts` pin that the module leaves it alone.
export default defineEventHandler(() => '# Layered\n')
