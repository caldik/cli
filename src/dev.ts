import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { startPluginTypeRefresh } from "./plugin-types"
import { loadStorefrontSnapshot, snapshotEnvironment, type StorefrontSnapshot } from "./storefront-data"
import injectionSource from "./dev-inject.cjs" with { type: "text" }
import { findExecutable, launchCommand, spawnCommand } from "./process"

import {
  readProjectConfig,
  type ProjectConfig,
} from "./config"

async function fileExists(filePath: string) {
  return await access(filePath).then(() => true).catch(() => false)
}

export function projectDevEnvironment(config: ProjectConfig): Record<string, string> {
  if (config.kind === "template") return {}

  return {
    CALDIK_STORE_ID: config.storeId,
    CALDIK_API_URL: config.apiUrl,
    NEXT_PUBLIC_CALDIK_STORE_ID: config.storeId,
    NEXT_PUBLIC_CALDIK_API_URL: config.apiUrl,
    VITE_CALDIK_STORE_ID: config.storeId,
    VITE_CALDIK_API_URL: config.apiUrl,
    PUBLIC_CALDIK_STORE_ID: config.storeId,
    PUBLIC_CALDIK_API_URL: config.apiUrl,
  }
}

const packageManagers = ["npm", "pnpm", "bun", "yarn"] as const
type PackageManager = typeof packageManagers[number]

export async function resolveDevCommand(
  root: string,
  packageManager?: string,
  which: (name: string) => string | null = findExecutable,
) {
  let selected: PackageManager | undefined
  if (packageManager) {
    const name = packageManager.split("@")[0]
    if (!packageManagers.includes(name as PackageManager)) {
      throw new Error(`Unsupported package manager: ${name}. Use npm, pnpm, Bun, or Yarn in package.json.`)
    }
    selected = name as PackageManager
  }
  else {
    const lockfiles: [string, PackageManager][] = [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["package-lock.json", "npm"],
      ["npm-shrinkwrap.json", "npm"],
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
    ]
    for (const [filename, manager] of lockfiles) {
      if (await fileExists(path.join(root, filename))) {
        selected = manager
        break
      }
    }
  }

  if (!selected) selected = packageManagers.find((manager) => which(manager))
  if (!selected) throw new Error("No package manager found. Install npm, pnpm, Bun, or Yarn, then run `caldik dev` again.")
  if (!which(selected)) {
    throw new Error(`This directory uses ${selected}, but it is not available on PATH. Install ${selected}, then run \`caldik dev\` again.`)
  }
  return selected === "yarn" ? [selected, "dev"] : [selected, "run", "dev"]
}

export async function startLocalDevServer(
  root: string,
  environment: Record<string, string>,
  snapshot?: StorefrontSnapshot,
) {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>
    packageManager?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  if (!manifest.scripts?.dev) throw new Error("package.json does not define a dev script")

  const command = await resolveDevCommand(root, manifest.packageManager)
  const script = manifest.scripts.dev, dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const framework = /\b(?:vinext|vite)\b/.test(script) ? "vite"
    : dependencies.next || /\bnext\s+dev\b/.test(script) ? "next"
    : dependencies.astro || /\bastro\s+dev\b/.test(script) ? "astro"
    : dependencies.vite || /\bvite\b/.test(script) ? "vite" : null
  if (snapshot && framework) {
    const directory = await mkdtemp(path.join(tmpdir(), "caldik-dev-"))
    const preload = path.join(directory, "store-data.cjs")
    await writeFile(preload, injectionSource)
    const nodeOptions = `${environment.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload.replace(/\\/g, "/"))}`.trim()
    console.log(`[dev] Starting ${command.join(" ")}`)
    try {
      const child = spawnCommand(command, { cwd: root, env: { ...process.env, ...environment, ...snapshotEnvironment(snapshot), NODE_OPTIONS: nodeOptions } })
      return { exited: child.exited.finally(() => rm(directory, { recursive: true, force: true })), kill() { child.kill() } }
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  }

  console.log(`[dev] Starting ${command.join(" ")}`)
  return spawnCommand(command, {
    cwd: root,
    env: {
      ...process.env,
      ...environment,
    },
  })
}

function openVisualStudioCode(root: string) {
  const executable = findExecutable("code")
  if (!executable) return
  launchCommand([executable, root])
  console.log("Opened this directory in Visual Studio Code.")
}

export async function dev() {
  const root = process.cwd()
  const config = await readProjectConfig(root)
  const environment = projectDevEnvironment(config)
  let snapshot: StorefrontSnapshot | undefined

  if (config.kind === "template") {
    console.log("[dev] Install this template on a store to use store data during development.")
  }
  else {
    console.log(`[dev] Store: ${config.storeName} (${config.storeId})`)
    console.log(`[dev] API: ${config.apiUrl}`)
    try {
      snapshot = await loadStorefrontSnapshot(config.storeId, config.apiUrl)
      Object.assign(environment, snapshotEnvironment(snapshot))
      console.log("[dev] Public store profile loaded for this development session")
    } catch (error) {
      console.warn(`[dev] Store profile preload unavailable; SDK requests will use the API: ${error instanceof Error ? error.message : error}`)
    }
  }

  const server = await startLocalDevServer(root, environment, snapshot)
  const stopPluginTypes = await startPluginTypeRefresh(root, config)
  openVisualStudioCode(root)

  const stop = () => { stopPluginTypes(); server.kill() }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  process.once("SIGHUP", stop)

  try {
    const exitCode = await server.exited
    if (exitCode !== 0 && exitCode !== 130 && exitCode !== 143) {
      process.exitCode = exitCode
    }
  }
  finally {
    stopPluginTypes()
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    process.removeListener("SIGHUP", stop)
  }
}
