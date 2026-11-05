import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { ProjectConfig } from "./config"

type RefreshModule = {
  refreshPluginTypes(options: { storeId: string; apiUrl: string; projectRoot: string; signal: AbortSignal }): Promise<unknown>
}
type RefreshOptions = {
  intervalMs?: number
  load?: (root: string) => Promise<RefreshModule | null>
  onError?: () => void
  onReady?: () => void
}

async function installedPluginTypeFile(root: string) {
  // Bun's standalone resolver can miss packages outside its embedded graph.
  // Read the consuming project's export map when its physical SDK is invisible there.
  for (let directory = path.resolve(root);;) {
    const packageRoot = path.join(directory, "node_modules", "@caldik", "client")
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (manifest) {
      const entry = manifest.exports?.["./development"]
      const target = typeof entry === "string" ? entry : entry?.import ?? entry?.default
      if (typeof target !== "string" || !target.startsWith("./")) return null
      const filename = path.resolve(packageRoot, target)
      const relative = path.relative(packageRoot, filename)
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid SDK development export")
      return filename
    }
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

export async function loadPluginTypeModule(root: string): Promise<RefreshModule | null> {
  let filename: string | null
  try {
    const require = createRequire(path.join(root, "package.json"))
    filename = require.resolve("@caldik/client/development")
  }
  catch (error) {
    if (!["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
    filename = await installedPluginTypeFile(root)
  }
  if (!filename) return null
  const module = await import(pathToFileURL(filename).href)
  return typeof module.refreshPluginTypes === "function" ? module : null
}

/** Reuse the dev session's store context; never request or forward CLI credentials. */
export async function startPluginTypeRefresh(root: string, config: ProjectConfig, options: RefreshOptions = {}) {
  const noop = () => {}
  if (config.kind === "template") return noop
  const onError = options.onError ?? (() => console.warn("[dev] Plugin autocomplete could not refresh; retrying in the background."))
  const onReady = options.onReady ?? (() => console.log("[dev] Plugin autocomplete ready."))
  let module: RefreshModule | null
  try { module = await (options.load ?? loadPluginTypeModule)(root) }
  catch { onError(); return noop }
  if (!module) return noop
  const refreshModule = module
  const controller = new AbortController()
  let stopped = false
  let running = false
  let warned = false
  let reported = false
  const refresh = async () => {
    if (stopped || running) return
    running = true
    try {
      const result = await refreshModule.refreshPluginTypes({ storeId: config.storeId, apiUrl: config.apiUrl, projectRoot: root, signal: controller.signal })
      if (!stopped && (!reported || warned || (result as { changed?: boolean } | undefined)?.changed)) {
        onReady()
        reported = true
      }
      warned = false
    }
    catch {
      if (!stopped && !warned) { warned = true; onError() }
    }
    finally { running = false }
  }
  void refresh()
  const timer = setInterval(() => { void refresh() }, options.intervalMs ?? 30_000)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
    controller.abort()
  }
}
