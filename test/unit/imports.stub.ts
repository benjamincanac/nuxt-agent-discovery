/**
 * Stands in for Nitro's `#imports`, which only exists inside a build.
 *
 * The server utils read their config through it, so without this they can only
 * be exercised from an e2e fixture, twenty seconds of build away from the
 * assertion. Aliased in `vitest.config.ts`; the e2e suites talk to a real
 * fixture server over HTTP and never load this.
 */
let values: Record<string, unknown> = {}

export function useRuntimeConfig(): Record<string, unknown> {
  return values
}

/** Replaces the stubbed config wholesale, so a test cannot inherit another's. */
export function setRuntimeConfig(next: Record<string, unknown>): void {
  values = next
}
