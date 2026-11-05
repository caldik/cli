#!/usr/bin/env node

import { requestTemplateCreation, templateCreateOptions, type MarketplaceTemplate } from "./templates"

import { readFile } from "node:fs/promises"
import path from "node:path"

import packageJson from "../package.json"
import { apiRequest, ApiError } from "./api"
import { deployOptions, deployPlugin, isPluginProject } from "./marketplace-deploy"
import { login, logout, whoami } from "./auth"
import {
  DEFAULT_API_URL,
  type ProjectConfig,
  type StoreProjectConfig,
  projectName,
  projectSourcePath,
  readCredentials,
  readProjectConfig,
  writeProjectConfig,
} from "./config"
import {
  applyLocalSourceDelta,
  apiSourceFiles,
  collectLocalFiles,
  formatSourceChanges,
  remoteSourceDelta,
  replaceLocalFiles,
  sourceDelta,
  sourceChange,
  type SourceManifestFile,
} from "./files"
import { dev } from "./dev"
import { promptText, selectOption, SelectionCancelledError } from "./prompt"
import { waitForDeploymentProgress } from "./deployment"
import { DeploymentDisplay } from "./deployment-ui"
import { selectBuildMachine, type BuildMachineId } from "./build-machine"
import { ProgressBar, Spinner } from "./ui"
import { formatHelp } from "./help"
import { sleep } from "./process"

type Store = { id: string, name: string, domain: string, suspended?: boolean }
type Template = MarketplaceTemplate

type ProjectTarget =
  | { kind: "store", store: Store }
  | { kind: "template", template: Template }


async function stores(apiUrl: string) {
  return (await apiRequest<{ stores: Store[] }>(apiUrl, "/v1/users/me")).stores
}

async function templates(apiUrl: string) {
  return (await apiRequest<{ templates: Template[] }>(
    apiUrl,
    "/v1/users/developers/marketplace",
  ).catch((error) => { if (error instanceof ApiError && error.status === 403) return { templates: [] }; throw error })).templates
}

async function selectProject(apiUrl: string) {
  const loading = new Spinner("Loading stores and marketplace templates").start()
  const [account, availableTemplates] = await Promise.all([
    apiRequest<{ role: string; stores: Store[] }>(apiUrl, "/v1/users/me"),
    templates(apiUrl),
  ]).catch((error) => {
    loading.fail("Could not load stores and marketplace templates")
    throw error
  })
  const availableStores = account.stores
  loading.succeed(
    `Loaded ${availableStores.length} store${availableStores.length === 1 ? "" : "s"} and ` +
    `${availableTemplates.length} template${availableTemplates.length === 1 ? "" : "s"}`,
  )
  const options: Array<{ label: string; value: ProjectTarget | { kind: "new_template" } }> = [
    ...availableStores.map((store) => ({
      label: `Store      ${store.name} (${store.domain})`,
      value: { kind: "store" as const, store },
    })),
    ...(account.role === "admin" ? [{ label: "Create a new template", value: { kind: "new_template" as const } }] : []),
    ...availableTemplates.map((template) => ({
      label: `Template   ${template.name} (${template.status})`,
      value: { kind: "template" as const, template },
    })),
  ]
  if (options.length === 0) {
    throw new Error("No stores or marketplace templates are available for this account")
  }
  const selected = await selectOption<ProjectTarget | { kind: "new_template" }>("Select a store or marketplace template:", options)
  return selected.kind === "new_template" ? createTemplateTarget(apiUrl, [], availableStores) : selected
}

async function createTemplateTarget(apiUrl: string, args: string[] = [], availableStores?: Store[]): Promise<Extract<ProjectTarget, { kind: "template" }>> {
  const options = templateCreateOptions(args)
  const name = options.name ?? await promptText("Template name", path.basename(process.cwd()))
  let sourceStoreId = options.sourceStoreId
  if (!options.blank && !sourceStoreId) {
    const choices = availableStores ?? await stores(apiUrl)
    sourceStoreId = await selectOption<string | undefined>("Template source:", [
      { label: "Blank template", value: undefined },
      ...choices.map(store => ({ label: `Copy ${store.name} (${store.domain})`, value: store.id })),
    ])
  }
  const progress = new Spinner("Creating template").start()
  try {
    const template = await requestTemplateCreation(apiUrl, { name, sourceStoreId })
    progress.succeed(`Created ${template.name} (${template.id})`)
    return { kind: "template", template }
  } catch (error) { progress.fail("Could not create template"); throw error }
}

async function createTemplateCommand(args: string[]) {
  templateCreateOptions(args)
  const credentials = await readCredentials()
  const target = await createTemplateTarget(credentials!.apiUrl, args)
  await writeProjectConfig({ version: 1, kind: "template", templateId: target.template.id, templateName: target.template.name, apiUrl: credentials!.apiUrl })
  if ((await collectLocalFiles(process.cwd())).length === 0) await pull()
  console.log("This directory is now connected to the template. Local files are preserved.")
  console.log("Use caldik pull to download the saved template source, or caldik deploy to upload and build a draft version.")
}

async function init() {
  const credentials = await readCredentials()
  const target = await selectProject(credentials!.apiUrl)
  const name = target.kind === "template" ? target.template.name : target.store.name
  const sourcePath = target.kind === "template"
    ? `/v1/users/developers/marketplace/${encodeURIComponent(target.template.id)}/source`
    : `/v1/stores/${encodeURIComponent(target.store.id)}/builder/project/source`
  const directory = process.cwd()
  const loading = new Spinner("Checking for files saved in Caldik").start()
  const remote = await apiRequest<{
    files: Array<{ path: string, contentBase64: string }>
    savedAt?: number
  }>(credentials!.apiUrl, sourcePath).catch((error) => {
    loading.fail("Could not load files saved in Caldik")
    throw error
  })
  loading.succeed(remote.files.length > 0 ? "Found files saved in Caldik" : "No files saved in Caldik")
  let pullExisting = false

  if (remote.files.length > 0) {
    pullExisting = await selectOption(
      `${name} has files saved in Caldik. Choose how to set up this directory:`,
      [
        { label: "Download the files saved in Caldik", value: true },
        { label: "Keep the current local files (or start with an empty directory)", value: false },
      ],
    )
  }

  const progress = new ProgressBar("Setting up this directory")
  progress.update(10)
  if (pullExisting) {
    await replaceLocalFiles(directory, remote.files, (completed, total, filePath) => {
      progress.update(30 + (total === 0 ? 60 : completed / total * 60), `Writing ${filePath}`)
    })
  }
  else {
    progress.update(80, "Saving Caldik configuration")
  }
  await writeProjectConfig(target.kind === "template"
    ? {
        version: 1,
        kind: "template",
        templateId: target.template.id,
        templateName: target.template.name,
        apiUrl: credentials!.apiUrl,
      }
    : {
        version: 1,
        kind: "store",
        storeId: target.store.id,
        storeName: target.store.name,
        apiUrl: credentials!.apiUrl,
      }, directory)
  progress.complete(`Connected this directory to ${name}`)
  if (pullExisting) console.log(`Downloaded ${remote.files.length} file${remote.files.length === 1 ? "" : "s"} from Caldik.`)
}

async function listStores() {
  const credentials = await readCredentials()
  const loading = new Spinner("Loading stores").start()
  const available = await stores(credentials!.apiUrl).catch((error) => {
    loading.fail("Could not load stores")
    throw error
  })
  loading.succeed(`Loaded ${available.length} store${available.length === 1 ? "" : "s"}`)
  if (available.length === 0) {
    console.log("No stores found.")
    return
  }
  for (const store of available) console.log(`${store.id}\t${store.name}\t${store.domain}`)
}

async function pull(directory = process.cwd(), config?: ProjectConfig) {
  const projectConfig = config ?? await readProjectConfig(directory)
  const name = projectName(projectConfig)
  const downloading = new Spinner(`Comparing local files with files saved in Caldik for ${name}`).start()
  const localFiles = await collectLocalFiles(directory)
  const manifest = await apiRequest<{
    files: SourceManifestFile[]
    savedAt?: number
  }>(
    projectConfig.apiUrl,
    `${projectSourcePath(projectConfig)}/manifest`,
  ).catch((error) => {
    downloading.fail("Could not compare local files with files saved in Caldik")
    throw error
  })
  const delta = remoteSourceDelta(localFiles, manifest.files)
  if (delta.changed.length === 0 && delta.deleted.length === 0) {
    downloading.succeed(`Local files for ${name} are up to date`)
    return
  }
  downloading.update(
    `Downloading ${delta.changed.length} changed file${delta.changed.length === 1 ? "" : "s"}`,
  )
  const result = await apiRequest<{
    files: Array<{ path: string, contentBase64: string }>
  }>(projectConfig.apiUrl, `${projectSourcePath(projectConfig)}/files`, {
    method: "POST",
    body: { paths: delta.changed.map((file) => file.path) },
  }).catch((error) => {
    downloading.fail("Could not download files from Caldik")
    throw error
  })
  if (result.files.length !== delta.changed.length) {
    downloading.fail("Files saved in Caldik changed during download")
    throw new Error("Files saved in Caldik changed during download; run `caldik pull` again")
  }
  downloading.succeed(
    `Downloaded ${result.files.length} changed file${result.files.length === 1 ? "" : "s"}`,
  )
  const localByPath = new Map(localFiles.map((file) => [file.path, file]))
  const downloadedByPath = new Map(result.files.map((file) => [file.path, file]))
  const changes = [
    ...delta.changed.map((file) => sourceChange({
      path: file.path,
      status: localByPath.has(file.path) ? "M" : "A",
      before: localByPath.get(file.path),
      after: downloadedByPath.get(file.path),
    })),
    ...delta.deleted.map((filePath) => sourceChange({
      path: filePath,
      status: "D",
      before: localByPath.get(filePath),
    })),
  ]
  console.log(`\n${formatSourceChanges(changes)}\n`)
  const progress = new ProgressBar("Updating local files")
  progress.update(0)
  await applyLocalSourceDelta(directory, result.files, delta.deleted, (completed, total, filePath) => {
    progress.update(total === 0 ? 100 : completed / total * 100, `Applying ${filePath}`)
  })
  progress.complete(
    `Local files updated: ${result.files.length} downloaded, ${delta.deleted.length} deleted`,
  )
}

async function push(directory = process.cwd(), config?: ProjectConfig) {
  const projectConfig = config ?? await readProjectConfig(directory)
  const progress = new ProgressBar("Collecting local files")
  progress.update(0)
  const files = await collectLocalFiles(directory)
  progress.update(15, "Comparing local files with files saved in Caldik")
  const remote = await apiRequest<{ files: SourceManifestFile[] }>(
    projectConfig.apiUrl,
    `${projectSourcePath(projectConfig)}/manifest`,
  ).catch((error) => {
    progress.fail("Could not compare local files with files saved in Caldik")
    throw error
  })
  const delta = sourceDelta(files, remote.files)
  if (delta.changed.length === 0 && delta.deleted.length === 0) {
    progress.complete(`Files saved in Caldik for ${projectName(projectConfig)} are up to date`)
    return
  }
  const remoteByPath = new Map(remote.files.map((file) => [file.path, file]))
  const previousPaths = [
    ...delta.changed
      .filter((file) => remoteByPath.has(file.path))
      .map((file) => file.path),
    ...delta.deleted,
  ]
  progress.update(25, "Loading saved files to summarize changes")
  const previous = previousPaths.length > 0
    ? await apiRequest<{
        files: Array<{ path: string, contentBase64: string }>
      }>(projectConfig.apiUrl, `${projectSourcePath(projectConfig)}/files`, {
        method: "POST",
        body: { paths: previousPaths },
      }).catch((error) => {
        progress.fail("Could not load files saved in Caldik")
        throw error
      })
    : { files: [] }
  if (previous.files.length !== previousPaths.length) {
    progress.fail("Files saved in Caldik changed during comparison")
    throw new Error("Files saved in Caldik changed during comparison; run `caldik push` again")
  }
  const previousByPath = new Map(previous.files.map((file) => [file.path, file]))
  const changes = [
    ...delta.changed.map((file) => sourceChange({
      path: file.path,
      status: remoteByPath.has(file.path) ? "M" : "A",
      before: previousByPath.get(file.path),
      after: file,
    })),
    ...delta.deleted.map((filePath) => sourceChange({
      path: filePath,
      status: "D",
      before: previousByPath.get(filePath),
    })),
  ]
  progress.complete(`Found changes in ${changes.length} file${changes.length === 1 ? "" : "s"}`)
  console.log(`\n${formatSourceChanges(changes)}\n`)
  const uploading = new Spinner(
    `Saving changes in Caldik: ${delta.changed.length} file${delta.changed.length === 1 ? "" : "s"} to upload, ${delta.deleted.length} to delete`,
  ).start()
  await apiRequest(projectConfig.apiUrl, projectSourcePath(projectConfig), {
    method: "PATCH",
    body: {
      files: apiSourceFiles(delta.changed),
      deleted: delta.deleted,
    },
  }).catch((error) => {
    uploading.fail("Could not save file changes in Caldik")
    throw error
  })
  uploading.succeed(
    `Files saved in Caldik updated: ${delta.changed.length} uploaded, ${delta.deleted.length} deleted`,
  )
}

async function deploy(args: string[]) {
  const options = deployOptions(args)
  if (options.artifact || await isPluginProject(process.cwd())) {
    if (options.buildMachine) throw new Error("Plugin artifacts build locally; --machine applies to store and template deployments.")
    if (options.version) throw new Error("Plugin versions come from the built manifest. Run caldik deploy without a version argument.")
    const credentials = await readCredentials()
    const draft = await deployPlugin(credentials!.apiUrl, process.cwd(), options.artifact)
    console.log(`Draft ${draft.name} v${draft.version} uploaded (${draft.pluginId}).`)
    console.log("Test your draft, then submit it for review in Marketplace > Manage.")
    return
  }
  const config = await readProjectConfig()
  if (config.kind === "template") return await deployTemplate(options.version, await selectBuildMachine(options.buildMachine))
  if (options.version) throw new Error("Version arguments apply to marketplace templates. Run caldik deploy for this store.")
  return await deployStore(config, await selectBuildMachine(options.buildMachine))
}

async function deployStore(config: StoreProjectConfig, buildMachine: BuildMachineId) {
  const display = new DeploymentDisplay()
  display.requesting()
  try {
    const result = await apiRequest<{
      deployment: { id: string, status: string, jobId?: string, url: string }
    }>(config.apiUrl, `/v1/stores/${encodeURIComponent(config.storeId)}/builder/publish`, {
      method: "POST",
      body: { useProjectSource: true, buildMachine },
    })
    display.accepted()
    const progressSession = await apiRequest<{ websocketUrl: string }>(
      config.apiUrl,
      `/v1/stores/${encodeURIComponent(config.storeId)}/builder/deployments/${encodeURIComponent(result.deployment.id)}/progress-session`,
      { method: "POST" },
    )
    const completed = await waitForDeploymentProgress(progressSession.websocketUrl, result.deployment.id,
      (progress, stage) => display.update(progress, stage))
    display.ready(result.deployment.url, completed.buildDurationSeconds)
  } catch (error) { display.fail(); throw error }
}

async function templateVersion(explicitVersion?: string) {
  let version = explicitVersion?.trim()
  if (!version) {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string }
    version = manifest.version?.trim()
  }
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Specify a version, such as `caldik deploy 1.0.0`, or set version in package.json.")
  }
  return version
}

async function deployTemplate(explicitVersion?: string, buildMachine: BuildMachineId = "4cpu") {
  const config = await readProjectConfig()
  if (config.kind !== "template") {
    throw new Error("To deploy a store, run `caldik deploy`.")
  }
  const versionName = await templateVersion(explicitVersion)
  await push()
  const display = new DeploymentDisplay()
  display.requesting()
  try {
    const result = await apiRequest<{
      version: {
        id: string
        artifactRef?: string | null
        manifest?: Record<string, unknown>
      }
      build?: { deploymentId: string, jobId?: string, status: string }
    }>(
      config.apiUrl,
      `/v1/users/developers/marketplace/${encodeURIComponent(config.templateId)}/versions`,
      { method: "POST", body: { version: versionName, buildMachine } },
    )
    display.accepted()
    const deadline = Date.now() + 60 * 60 * 1000
    let artifactRef = result.version.manifest?.buildStatus === "complete" ? result.version.artifactRef || null : null
    let duration = result.version.manifest?.buildDurationSeconds
    let previewUrl: string | undefined
    while (!artifactRef && Date.now() < deadline) {
      await sleep(1500)
      const detail = await apiRequest<{
        template: {
          previewUrl?: string
          versions: Array<{
            id: string
            artifactRef?: string | null
            manifest?: Record<string, unknown>
          }>
        }
      }>(
        config.apiUrl,
        `/v1/users/developers/marketplace/${encodeURIComponent(config.templateId)}`,
      )
      const version = detail.template.versions.find((item) => item.id === result.version.id)
      if (!version) {
        throw new Error("The template version is no longer available in Caldik.")
      }
      const status = String(version.manifest?.buildStatus || "queued")
      const stage = String(version.manifest?.buildStage || "Initializing")
      const progress = Number(version.manifest?.buildProgress || 0)
      display.update(progress, stage)
      if (status === "failed") {
        throw new Error("Template build failed")
      }
      // An artifact is uploaded before preview activation; wait for the terminal
      // state so the CLI cannot announce a failed/incomplete deployment as ready.
      artifactRef = status === "complete" ? version.artifactRef || null : null
      duration = version.manifest?.buildDurationSeconds
      previewUrl = detail.template.previewUrl
    }
    if (!artifactRef) {
      throw new Error("Template build timed out")
    }
    display.ready(previewUrl, typeof duration === "number" ? duration : undefined)
    console.log("Draft build ready. Test it, then submit it for review in Marketplace > Manage.")
  } catch (error) { display.fail(); throw error }
}

async function listTemplates() {
  const credentials = await readCredentials()
  const loading = new Spinner("Loading marketplace templates").start()
  const available = await templates(credentials!.apiUrl).catch((error) => {
    loading.fail("Could not load marketplace templates")
    throw error
  })
  loading.succeed(`Loaded ${available.length} template${available.length === 1 ? "" : "s"}`)
  if (available.length === 0) {
    console.log("No marketplace templates found.")
    return
  }
  for (const template of available) {
    console.log(`${template.id}\t${template.name}\t${template.status}\t${template.slug}`)
  }
}

async function main() {
  const [command, subcommand, ...rest] = process.argv.slice(2)
  if (!command || command === "help") return console.log(formatHelp(subcommand))
  if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
    return console.log(formatHelp(command))
  }
  if (command === "version" || process.argv.slice(2).some((arg) => arg === "--version" || arg === "-v")) return console.log(packageJson.version)
  if (command === "login") {
    const apiIndex = process.argv.indexOf("--api")
    const apiUrl = apiIndex >= 0 ? process.argv[apiIndex + 1] : DEFAULT_API_URL
    if (!apiUrl || apiUrl.startsWith("-")) throw new Error("Provide a URL after --api. Run `caldik login --help` for details.")
    return await login(apiUrl)
  }
  if (command === "logout") return await logout()
  if (command === "whoami") return await whoami()
  if (command === "init") return await init()
  if (command === "pull") return await pull()
  if (command === "push") return await push()
  if (command === "dev") return await dev()
  if (command === "deploy") return await deploy([subcommand, ...rest].filter((value): value is string => Boolean(value)))
  if (command === "store" && subcommand === "list") return await listStores()
  if (command === "template" && subcommand === "create") return await createTemplateCommand(rest)
  if (command === "template" && subcommand === "list") return await listTemplates()
  throw new Error(`Unknown command: ${[command, subcommand, ...rest].filter(Boolean).join(" ")}. Run caldik --help to see available commands.`)
}

main().catch((error) => {
  if (error instanceof SelectionCancelledError) {
    process.exitCode = 130
    return
  }
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
