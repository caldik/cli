import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { apiRequest } from "./api"
import { parseBuildMachine, type BuildMachineChoice } from "./build-machine"
import { findExecutable, spawnCommand } from "./process"

export function deployOptions(args: string[]) {
  let version: string | undefined, artifact: string | undefined
  let buildMachine: BuildMachineChoice | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === "--machine" || arg === "-machine" || arg.startsWith("--machine=") || arg.startsWith("-machine=")) {
      if (buildMachine) throw new Error("Use --machine only once.")
      const equals = arg.indexOf("=")
      const value = equals >= 0 ? arg.slice(equals + 1) : args[index + 1]
      if (equals < 0 && (!value || value.startsWith("-"))) buildMachine = "select"
      else {
        buildMachine = value ? parseBuildMachine(value) : undefined
        if (!buildMachine) throw new Error("Use --machine 2c2g, 4c4g, 8c8g or 16c16g, or --machine to choose interactively.")
        if (equals < 0) index++
      }
    } else if (arg === "--artifact") {
      const value = args[++index]
      if (!value || value.startsWith("-") || artifact) throw new Error("Provide one plugin JSON path after --artifact.")
      artifact = value
    } else if (!arg.startsWith("-") && !version && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(arg)) version = arg
    else throw new Error(`Unknown deploy option: ${arg}. Run caldik deploy --help.`)
  }
  if (artifact && version) throw new Error("Plugin versions come from their artifact. Omit the version argument.")
  return { version, artifact, ...(buildMachine ? { buildMachine } : {}) }
}

export async function isPluginProject(directory: string) {
  return access(path.join(directory, "caldik.plugin.ts")).then(() => true, () => false)
}

export async function deployPlugin(apiUrl: string, directory: string, artifactPath?: string) {
  if (!artifactPath) {
    const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"))
    if (typeof pkg.scripts?.build !== "string") throw new Error("Add a plugin build script to package.json, or deploy an existing artifact with caldik deploy --artifact path/to/plugin.json.")
    const bun = findExecutable("bun")
    if (!bun) throw new Error("Install Bun to build this plugin, or use caldik deploy --artifact PATH for a built artifact.")
    const child = spawnCommand([bun, "run", "build"], { cwd: directory })
    if (await child.exited !== 0) throw new Error("Plugin build failed. No draft was uploaded.")
  }
  const raw = await readFile(path.resolve(directory, artifactPath ?? "dist/plugin.json"), "utf8")
  if (Buffer.byteLength(raw) > 1_200_000) throw new Error("Plugin artifacts must be smaller than 1.2 MB.")
  const artifact = JSON.parse(raw)
  if (!artifact?.manifest || typeof artifact.manifest.id !== "string" || typeof artifact.manifest.version !== "string") throw new Error("Choose a built plugin JSON artifact with a manifest.")
  const result = await apiRequest<{ pluginId: string; versionId: string; status: string }>(apiUrl, "/v1/users/marketplace/plugins/versions", { method: "POST", body: artifact })
  if (!result.pluginId || !result.versionId || result.status !== "draft") throw new Error("The API did not return a plugin draft.")
  return { ...result, name: artifact.manifest.name, version: artifact.manifest.version }
}
