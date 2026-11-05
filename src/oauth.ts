import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { readCredentials, writeCredentials, type Credentials } from "./config"

function apiOrigin(value: string) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS API origin or local loopback HTTP origin.")
  }
  return url.origin
}

export async function oauthJson<T>(apiUrl: string, path: string, body?: URLSearchParams | Record<string, unknown>) {
  const origin = apiOrigin(apiUrl)
  const url = new URL(path, origin)
  if (url.origin !== origin) throw new Error("OAuth endpoint has the wrong origin.")
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000),
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json" } : {},
    body: body ? body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error_description || `OAuth request failed (${response.status})`)
  return data as T
}

type Tokens = { access_token: string, refresh_token: string, expires_in: number, token_type: string }
function credentialsFor(apiUrl: string, clientId: string, resource: string, tokens: Tokens): Credentials {
  if (!tokens.access_token || !tokens.refresh_token || tokens.token_type !== "Bearer" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error("Invalid OAuth token response.")
  return { apiUrl, clientId, resource, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 }
}

export function loopbackCallback(state: string) {
  let resolve!: (code: string) => void
  let reject!: (error: Error) => void
  const code = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  // A browser callback may arrive before login starts awaiting this promise.
  void code.catch(() => undefined)
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const received = url.searchParams.get("state") || ""
    if (req.method !== "GET" || url.pathname !== "/oauth/callback" ||
      url.searchParams.getAll("state").length !== 1 || !/^[A-Za-z0-9_-]+$/.test(received) || received.length !== state.length ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(state))) {
      res.writeHead(400); res.end("Invalid callback."); return
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    const value = url.searchParams.get("code")
    if (url.searchParams.has("error") || !value || url.searchParams.getAll("code").length !== 1) {
      res.writeHead(400); res.end("Connection was not approved.")
      reject(new Error("Connection was not approved."))
    } else { res.end("Caldik login approved. You can close this tab."); resolve(value) }
  })
  const timer = setTimeout(() => reject(new Error("Login expired. Run `caldik login` again.")), 10 * 60_000)
  return { code,
    async listen() {
      await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes) })
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Cannot start login callback.")
      return `http://127.0.0.1:${address.port}/oauth/callback`
    },
    close() { clearTimeout(timer); server.close(); server.closeAllConnections() },
  }
}

export async function browserLogin(apiUrl: string, openBrowser: (url: string) => void) {
  apiUrl = apiOrigin(apiUrl)
  const resource = `${apiUrl}/v1`
  const verifier = randomBytes(48).toString("base64url")
  const state = randomBytes(32).toString("base64url")
  const callback = loopbackCallback(state)
  try {
    const redirectUri = await callback.listen()
    const metadata = await oauthJson<{ issuer: string, registration_endpoint: string, authorization_endpoint: string, token_endpoint: string }>(apiUrl, "/.well-known/oauth-authorization-server")
    if (metadata.issuer !== apiUrl || [metadata.registration_endpoint, metadata.authorization_endpoint, metadata.token_endpoint].some((value) => new URL(value).origin !== apiUrl)) throw new Error("Untrusted OAuth discovery endpoints.")
    const client = await oauthJson<{ client_id: string }>(apiUrl, metadata.registration_endpoint, {
      client_name: "Caldik CLI", redirect_uris: [redirectUri], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    })
    const authorization = new URL(metadata.authorization_endpoint)
    authorization.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
      response_type: "code", resource, scope: "cli.manage", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    }).toString()
    console.log(`Open this URL to log in to Caldik:\n${authorization}`)
    openBrowser(authorization.toString())
    const tokens = await oauthJson<Tokens>(apiUrl, metadata.token_endpoint, new URLSearchParams({
      grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri,
      code_verifier: verifier, code: await callback.code, resource,
    }))
    await writeCredentials(credentialsFor(apiUrl, client.client_id, resource, tokens))
  } finally { callback.close() }
}

let refreshing: Promise<Credentials> | undefined
export async function activeCredentials() {
  const credentials = (await readCredentials())!
  if (credentials.expiresAt > Date.now() + 60_000) return credentials
  if (!refreshing) refreshing = (async () => {
    const tokens = await oauthJson<Tokens>(credentials.apiUrl, "/v1/auth/oauth/token", new URLSearchParams({
      grant_type: "refresh_token", client_id: credentials.clientId!, refresh_token: credentials.refreshToken!, resource: credentials.resource!,
    }))
    const next = credentialsFor(credentials.apiUrl, credentials.clientId!, credentials.resource!, tokens)
    await writeCredentials(next)
    return next
  })().finally(() => { refreshing = undefined })
  return refreshing
}
