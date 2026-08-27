import { useAgentDiscoveryConfig } from '#agent-discovery'

/**
 * The config the module actually resolved, so a test can assert against it
 * rather than against a literal that restates the fixture's `nuxt.config`.
 *
 * The route table is generated from `routes` alone, so the property worth
 * checking is that the module kept the locale as a wildcard. A duplicated
 * literal cannot show that: it would pass just the same if the module expanded
 * the locale wildcard into one pattern per locale, which is the failure this
 * fixture exists to catch.
 */
export default defineEventHandler(event => useAgentDiscoveryConfig(event))
