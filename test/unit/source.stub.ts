import type { AgentContentSource } from '../../src/runtime/shared/types'

/**
 * Stands in for `#agent-discovery/source`, the alias the module points at the
 * site's content adapter.
 *
 * The server utils import it directly, so an adapter that only implements part
 * of the seam can otherwise only be exercised from an e2e fixture. Aliased in
 * `vitest.config.ts`; the e2e suites run against a real fixture build and never
 * load this.
 */
// Mutable on purpose: the utils import the default binding directly, so
// reassigning it is the only way a test can hand them another adapter.
// eslint-disable-next-line import/no-mutable-exports
let source: AgentContentSource | null = null

export { source as default }

/** Replaces the stubbed adapter wholesale, so a test cannot inherit another's. */
export function setAgentContentSource(next: AgentContentSource | null): void {
  source = next
}
