import { mkdir, readFile, readdir, stat, writeFile, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"

const ignoredNames = new Set([
  ".git", ".caldik", ".next", ".open-next", "node_modules", "out", "dist",
])
const runtimeBuildOnlyPaths = new Set(["open-next.config.ts", "wrangler.json"])

export type LocalSourceFile = {
  path: string
  contentBase64: string
  contentType: string
  size: number
  hash: string
}

export type SourceManifestFile = {
  path: string
  size: number
  hash: string
}

export type SourceFileContent = {
  path: string
  contentBase64: string
  contentType?: string
}

export type SourceChange = {
  path: string
  status: "A" | "M" | "D"
  additions: number | null
  deletions: number | null
  binary: boolean
}

function knownTextContentType(value: string | undefined) {
  if (!value) return null
  const normalized = value.toLowerCase().split(";", 1)[0]!
  if (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/javascript" ||
    normalized === "application/xml" ||
    normalized === "application/yaml" ||
    normalized === "application/x-yaml" ||
    normalized === "image/svg+xml"
  ) return true
  if (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized === "application/pdf" ||
    normalized === "application/zip" ||
    normalized === "application/wasm"
  ) return false
  return null
}

function knownTextPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const name = path.basename(filePath).toLowerCase()
  if ([
    ".dockerignore", ".editorconfig", ".gitattributes", ".gitignore",
    ".npmrc", ".nvmrc", "dockerfile", "license", "makefile", "procfile",
  ].includes(name)) return true
  if ([
    ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".csv", ".env",
    ".go", ".graphql", ".h", ".hpp", ".html", ".ini", ".java",
    ".js", ".json", ".jsx", ".less", ".lua", ".md", ".mdx",
    ".lock", ".mjs", ".php", ".prisma", ".properties", ".py", ".rb", ".rs",
    ".scss", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt",
    ".vue", ".xml", ".yaml", ".yml",
  ].includes(extension)) return true
  if ([
    ".7z", ".avif", ".bmp", ".eot", ".gif", ".gz", ".ico", ".jpeg",
    ".jpg", ".mp3", ".mp4", ".otf", ".pdf", ".png", ".tar", ".ttf",
    ".wasm", ".wav", ".webm", ".webp", ".woff", ".woff2", ".zip",
  ].includes(extension)) return false
  return null
}

function decodeText(file: SourceFileContent | undefined) {
  if (!file) return { binary: false, text: "" }
  const body = Buffer.from(file.contentBase64, "base64")
  const known = knownTextContentType(file.contentType) ?? knownTextPath(file.path)
  if (known === false || body.includes(0)) return { binary: true, text: "" }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    if (known === true) return { binary: false, text }

    let controls = 0
    for (const byte of body) {
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
        controls += 1
      }
    }
    return controls > Math.max(1, body.byteLength * 0.02)
      ? { binary: true, text: "" }
      : { binary: false, text }
  }
  catch {
    return { binary: true, text: "" }
  }
}

function lines(value: string) {
  if (!value) return []
  const result = value.split("\n")
  if (value.endsWith("\n")) result.pop()
  return result
}

function fallbackLineCounts(before: string[], after: string[]) {
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) prefix += 1

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1

  return {
    additions: after.length - prefix - suffix,
    deletions: before.length - prefix - suffix,
  }
}

function lineCounts(beforeText: string, afterText: string) {
  const before = lines(beforeText)
  const after = lines(afterText)
  if (before.length === 0) return { additions: after.length, deletions: 0 }
  if (after.length === 0) return { additions: 0, deletions: before.length }

  const maximum = before.length + after.length
  const offset = maximum + 1
  const frontier = new Int32Array(maximum * 2 + 3)
  frontier[offset + 1] = 0
  let operations = 0

  for (let distance = 0; distance <= maximum; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      operations += 1
      if (operations > 2_000_000) return fallbackLineCounts(before, after)

      const index = offset + diagonal
      let x = diagonal === -distance || (
        diagonal !== distance && frontier[index - 1]! < frontier[index + 1]!
      )
        ? frontier[index + 1]!
        : frontier[index - 1]! + 1
      let y = x - diagonal

      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1
        y += 1
      }
      frontier[index] = x

      if (x >= before.length && y >= after.length) {
        const delta = after.length - before.length
        return {
          additions: (distance + delta) / 2,
          deletions: (distance - delta) / 2,
        }
      }
    }
  }

  return fallbackLineCounts(before, after)
}

export function sourceChange(input: {
  path: string
  status: SourceChange["status"]
  before?: SourceFileContent
  after?: SourceFileContent
}): SourceChange {
  const before = decodeText(input.before)
  const after = decodeText(input.after)
  if (before.binary || after.binary) {
    return {
      path: input.path,
      status: input.status,
      additions: null,
      deletions: null,
      binary: true,
    }
  }

  const counts = lineCounts(before.text, after.text)
  return { path: input.path, status: input.status, ...counts, binary: false }
}

export function formatSourceChanges(changes: SourceChange[]) {
  const ordered = [...changes].sort((left, right) => left.path.localeCompare(right.path))
  const labels = ordered.map((change) => `${change.status} ${change.path}`)
  const width = Math.max(0, ...labels.map((label) => label.length))
  let additions = 0
  let deletions = 0
  let binary = 0
  const rows = ordered.map((change, index) => {
    let stats: string
    if (change.binary) {
      binary += 1
      stats = "binary"
    }
    else {
      additions += change.additions || 0
      deletions += change.deletions || 0
      const parts = [
        change.additions ? `+${change.additions}` : "",
        change.deletions ? `-${change.deletions}` : "",
      ].filter(Boolean)
      stats = parts.join(" ") || "+0 -0"
    }
    return ` ${labels[index]!.padEnd(width)}  ${stats}`
  })
  const summary = [
    `${ordered.length} file${ordered.length === 1 ? "" : "s"} changed`,
    `${additions} insertion${additions === 1 ? "" : "s"}(+)`,
    `${deletions} deletion${deletions === 1 ? "" : "s"}(-)`,
    ...(binary > 0
      ? [`${binary} binary file${binary === 1 ? "" : "s"}`]
      : []),
  ].join(", ")

  return ["Changes", "", ...rows, "", summary].join("\n")
}

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".json") return "application/json"
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "text/javascript"
  if ([".ts", ".tsx"].includes(extension)) return "text/typescript"
  if (extension === ".css") return "text/css"
  if (extension === ".html") return "text/html"
  if ([".lock", ".md", ".mdx", ".txt"].includes(extension)) return "text/plain"
  if (knownTextPath(filePath) === true) return "text/plain"
  if (extension === ".svg") return "image/svg+xml"
  if (extension === ".png") return "image/png"
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg"
  if (extension === ".webp") return "image/webp"
  return "application/octet-stream"
}

function safeTarget(root: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe project path: ${relativePath}`)
  }
  const rootPath = path.resolve(root)
  const target = path.resolve(rootPath, normalized)
  if (!target.startsWith(`${rootPath}${path.sep}`)) throw new Error(`Unsafe project path: ${relativePath}`)
  return target
}

function stripRuntimePackageConfiguration(body: Buffer) {
  try {
    const manifest = JSON.parse(body.toString("utf8")) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const hasScript = Boolean(manifest.scripts && "build:dynamic" in manifest.scripts)
    const hasDependency = Boolean(
      manifest.devDependencies && "@opennextjs/cloudflare" in manifest.devDependencies,
    )
    if (!hasScript && !hasDependency) return body
    if (manifest.scripts) delete manifest.scripts["build:dynamic"]
    if (manifest.devDependencies) delete manifest.devDependencies["@opennextjs/cloudflare"]
    return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  }
  catch {
    return body
  }
}

export async function removeRuntimeBuildConfiguration(root = process.cwd()) {
  for (const relativePath of runtimeBuildOnlyPaths) {
    await rm(safeTarget(root, relativePath), { force: true })
  }
  const manifestPath = safeTarget(root, "package.json")
  const manifest = await readFile(manifestPath).catch(() => null)
  if (!manifest) return
  const sanitized = stripRuntimePackageConfiguration(manifest)
  if (!sanitized.equals(manifest)) await writeFile(manifestPath, sanitized)
}

export async function collectLocalFiles(root = process.cwd()) {
  await removeRuntimeBuildConfiguration(root)
  const files: LocalSourceFile[] = []

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (ignoredNames.has(entry.name)) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(absolutePath)
      if (info.size > 25 * 1024 * 1024) {
        throw new Error(`${path.relative(root, absolutePath)} exceeds the 25MB source transfer limit`)
      }
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/")
      if (runtimeBuildOnlyPaths.has(relativePath)) continue
      const rawBody = await readFile(absolutePath)
      const body = relativePath === "package.json"
        ? stripRuntimePackageConfiguration(rawBody)
        : rawBody
      files.push({
        path: relativePath,
        contentBase64: body.toString("base64"),
        contentType: contentType(absolutePath),
        size: body.byteLength,
        hash: createHash("md5").update(body).digest("hex"),
      })
    }
  }

  await visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export function apiSourceFiles(files: LocalSourceFile[]) {
  return files.map(({ hash: _hash, ...file }) => file)
}

export function sourceManifest(files: LocalSourceFile[]) {
  return files.map(({ path: filePath, size, hash }) => ({ path: filePath, size, hash }))
}

export function sourceDelta(local: LocalSourceFile[], remote: SourceManifestFile[]) {
  const remoteByPath = new Map(remote.map((file) => [file.path, file]))
  const localPaths = new Set(local.map((file) => file.path))
  return {
    changed: local.filter((file) => remoteByPath.get(file.path)?.hash !== file.hash),
    deleted: remote.filter((file) => !localPaths.has(file.path)).map((file) => file.path),
    unchanged: local.filter((file) => remoteByPath.get(file.path)?.hash === file.hash).length,
  }
}

export function remoteSourceDelta(local: LocalSourceFile[], remote: SourceManifestFile[]) {
  const localByPath = new Map(local.map((file) => [file.path, file]))
  const remotePaths = new Set(remote.map((file) => file.path))
  return {
    changed: remote.filter((file) => localByPath.get(file.path)?.hash !== file.hash),
    deleted: local.filter((file) => !remotePaths.has(file.path)).map((file) => file.path),
    unchanged: remote.filter((file) => localByPath.get(file.path)?.hash === file.hash).length,
  }
}

export async function writeRemoteFile(root: string, relativePath: string, contentBase64: string) {
  const target = safeTarget(root, relativePath)
  await rm(target, { recursive: true, force: true })
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(contentBase64, "base64"))
}

export async function deleteRemotePath(root: string, relativePath: string) {
  await rm(safeTarget(root, relativePath), { recursive: true, force: true })
}

export async function hydrateDirectory(
  root: string,
  files: Array<{ path: string, contentBase64: string }>,
  onProgress?: (completed: number, total: number, path: string) => void,
) {
  let completed = 0
  for (const file of files) {
    await writeRemoteFile(root, file.path, file.contentBase64)
    completed += 1
    onProgress?.(completed, files.length, file.path)
  }
}

export async function replaceLocalFiles(
  root: string,
  files: Array<{ path: string, contentBase64: string }>,
  onProgress?: (completed: number, total: number, path: string) => void,
) {
  const incomingPaths = new Set(files.map((file) => file.path.replace(/\\/g, "/")))
  const currentFiles = await collectLocalFiles(root)
  for (const file of currentFiles.sort((left, right) => right.path.length - left.path.length)) {
    if (!incomingPaths.has(file.path)) await deleteRemotePath(root, file.path)
  }
  await hydrateDirectory(root, files, onProgress)
}

export async function applyLocalSourceDelta(
  root: string,
  files: Array<{ path: string, contentBase64: string }>,
  deleted: string[],
  onProgress?: (completed: number, total: number, path: string) => void,
) {
  const total = files.length + deleted.length
  let completed = 0
  for (const filePath of deleted.sort((left, right) => right.length - left.length)) {
    await deleteRemotePath(root, filePath)
    completed += 1
    onProgress?.(completed, total, filePath)
  }
  for (const file of files) {
    await writeRemoteFile(root, file.path, file.contentBase64)
    completed += 1
    onProgress?.(completed, total, file.path)
  }
}
