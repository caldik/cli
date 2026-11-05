import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type Credentials = {
  apiUrl: string
  accessToken: string
  expiresAt: number
  refreshToken?: string
  clientId?: string
  resource?: string
}

export type StoreProjectConfig = {
  version: 1
  kind?: "store"
  storeId: string
  storeName: string
  apiUrl: string
}

export type TemplateProjectConfig = {
  version: 1
  kind: "template"
  templateId: string
  templateName: string
  apiUrl: string
}

export type ProjectConfig = StoreProjectConfig | TemplateProjectConfig

export const DEFAULT_API_URL = process.env.CALDIK_API_URL || "https://api.caldik.com"

function credentialDirectory() {
  if (process.env.CALDIK_CONFIG_HOME) return process.env.CALDIK_CONFIG_HOME
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Caldik")
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "caldik")
}

function credentialPath() {
  return path.join(credentialDirectory(), "credentials.json")
}

export async function readCredentials(required = true) {
  const credentials = await readFile(credentialPath(), "utf8")
    .then((value) => JSON.parse(value) as Credentials)
    .catch(() => null)
  if (required && (!credentials || !credentials.refreshToken || !credentials.clientId || !credentials.resource)) {
    throw new Error("Not logged in. Run `caldik login` first.")
  }
  return credentials
}

export async function writeCredentials(credentials: Credentials) {
  await mkdir(credentialDirectory(), { recursive: true })
  await writeFile(credentialPath(), `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  await chmod(credentialPath(), 0o600).catch(() => undefined)
}

export async function clearCredentials() {
  await rm(credentialPath(), { force: true })
}

export function projectConfigPath(directory = process.cwd()) {
  return path.join(directory, ".caldik", "config.json")
}

export async function readProjectConfig(directory = process.cwd()) {
  const config = JSON.parse(await readFile(projectConfigPath(directory), "utf8")) as ProjectConfig
  const validTarget = config.kind === "template"
    ? Boolean(config.templateId && config.templateName)
    : Boolean(config.storeId && config.storeName)
  if (config.version !== 1 || !validTarget || !config.apiUrl) {
    throw new Error("Invalid .caldik/config.json. Run `caldik init` again.")
  }
  return config
}

export function projectName(config: ProjectConfig) {
  return config.kind === "template" ? config.templateName : config.storeName
}

export function projectSourcePath(config: ProjectConfig) {
  return config.kind === "template"
    ? `/v1/users/developers/marketplace/${encodeURIComponent(config.templateId)}/source`
    : `/v1/stores/${encodeURIComponent(config.storeId)}/builder/project/source`
}

export async function writeProjectConfig(config: ProjectConfig, directory = process.cwd()) {
  await mkdir(path.dirname(projectConfigPath(directory)), { recursive: true })
  await writeFile(projectConfigPath(directory), `${JSON.stringify(config, null, 2)}\n`)
}
