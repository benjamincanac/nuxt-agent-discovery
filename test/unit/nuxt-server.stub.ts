/**
 * Stands in for `nuxt/server`, whose runtime config and hooks only resolve
 * inside a build. Reads the config `nitro.stub.ts` holds, so a test sets it
 * once with `setRuntimeConfig()` whichever variant it runs. Aliased in
 * `vitest.config.ts`. Only what the tested files import.
 */
import { useRuntimeConfig as useNitroRuntimeConfig } from './nitro.stub'

export function useRuntimeConfig(): Record<string, unknown> {
  return useNitroRuntimeConfig()
}

/** The document hooks are called on every resolve; nothing here listens. */
export function useServerHooks() {
  return { hook: () => () => {}, callHook: async () => {} }
}

export function defineEventHandler<T>(handler: T): T {
  return handler
}

export function getRequestURL(event: { req: Request, url?: URL }): URL {
  return new URL(event.url ?? event.req.url)
}
