import { apiRequest } from "./api"
import { clearCredentials, DEFAULT_API_URL, readCredentials } from "./config"
import { browserLogin, oauthJson } from "./oauth"
import { launchCommand } from "./process"

function openBrowser(url: string) {
  const command = process.platform === "win32"
    ? ["rundll32.exe", "url.dll,FileProtocolHandler", url]
    : process.platform === "darwin" ? ["open", url] : ["xdg-open", url]
  launchCommand(command)
}

export async function login(apiUrl = DEFAULT_API_URL) {
  await browserLogin(apiUrl, openBrowser)
  console.log("Logged in.")
}

export async function logout() {
  const credentials = await readCredentials(false)
  try {
    if (credentials?.clientId && credentials.refreshToken) await oauthJson(credentials.apiUrl, "/v1/auth/oauth/revoke", new URLSearchParams({
      client_id: credentials.clientId, token: credentials.refreshToken,
    }))
  } catch {
    console.error("Could not revoke the remote connection. Local credentials will be removed.")
  } finally { await clearCredentials() }
  console.log("Logged out.")
}

export async function whoami() {
  const credentials = await readCredentials()
  const result = await apiRequest<{ name: string, email: string }>(credentials!.apiUrl, "/v1/users/me")
  console.log(`${result.name} <${result.email}>`)
}
