// A site-owned twin serving data the content adapter does not hold. The
// module's prerender pass must leave it alone (see `module setup: prerender`
// in `test/unit/module.test.ts`): freezing it at build is exactly what a site
// registering its own handler here opted out of.
export default defineEventHandler(() => '# Dynamic\n')
