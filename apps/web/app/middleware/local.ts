import type { Middleware } from "remix/router"

const hostname = (value: string): string | undefined => {
  const bracketed = value.startsWith("[") && value.includes("]")
  if (bracketed) return value.slice(1, value.indexOf("]")).toLowerCase()
  const colon = value.lastIndexOf(":")
  const host = colon >= 0 && value.indexOf(":") === colon ? value.slice(0, colon) : value
  return host.length > 0 && !/[/?#\s]/.test(host) ? host.toLowerCase() : undefined
}

export const localOnly = (hosts: ReadonlyArray<string>): Middleware => (context, next) => {
  const host = context.request.headers.get("Host")
  const name = host === null ? undefined : hostname(host)
  const allowed = name !== undefined && hosts.some((value) => value.toLowerCase() === name)
  return allowed ? next() : new Response("Forbidden", { status: 403 })
}
