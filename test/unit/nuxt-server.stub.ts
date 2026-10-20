/**
 * Stands in for `nuxt/server`, whose runtime config and hooks only resolve
 * inside a build. Reads the config `nitro.stub.ts` holds, so a test sets it
 * once with `setRuntimeConfig()` whichever variant it runs. Aliased in
 * `vitest.config.ts`.
 */
import { useRuntimeConfig as useNitroRuntimeConfig } from './nitro.stub'

interface StubEvent {
  req: Request
  url?: URL
  res: { status?: number, statusText?: string, headers: Headers }
}

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

export function getRequestURL(event: StubEvent): URL {
  return new URL(event.url ?? event.req.url)
}

export function getRequestHeader(event: StubEvent, name: string): string | undefined {
  return event.req.headers.get(name) ?? undefined
}

export function setResponseStatus(event: StubEvent, status: number, statusText?: string): void {
  event.res.status = status
  event.res.statusText = statusText
}

export function sendRedirect(event: StubEvent, location: string, status = 302): string {
  event.res.status = status
  event.res.headers.set('location', location)
  return ''
}

export function createError(input: { status?: number, statusText?: string, data?: unknown }): Error {
  return Object.assign(new Error(input.statusText), input)
}
