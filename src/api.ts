import { activeCredentials } from "./oauth"

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

export async function apiRequest<T>(
  apiUrl: string,
  pathname: string,
  options: {
    method?: string
    body?: unknown
    authenticated?: boolean
  } = {},
) {
  const headers = new Headers({ accept: "application/json" })
  if (options.body !== undefined) headers.set("content-type", "application/json")
  if (options.authenticated !== false) {
    const credentials = await activeCredentials()
    if (new URL(credentials.apiUrl).origin !== new URL(apiUrl).origin) throw new Error("This project uses a different API. Log in to that API first.")
    headers.set("authorization", `Bearer ${credentials!.accessToken}`)
  }

  const target = new URL(pathname, `${apiUrl.replace(/\/$/, "")}/`)
  if (target.origin !== new URL(apiUrl).origin) throw new Error("API request must stay on the configured origin.")
  const response = await fetch(target, {
    method: options.method || "GET",
    redirect: "error",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = await response.json().catch(() => null) as T & { message?: string }
  if (!response.ok) {
    throw new ApiError(response.status, body?.message || `Caldik API returned ${response.status}`, body)
  }
  return body
}
