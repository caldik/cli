import packageJson from "../package.json"
import { terminal } from "./terminal"

const commands = [
  { name: "init", usage: "init", icon: "🔗", description: "Connect this directory to a store or marketplace template" },
  { name: "dev", usage: "dev", icon: "🛠️", description: "Start the local development server" },
  { name: "pull", usage: "pull", icon: "⬇️", description: "Download file changes from Caldik" },
  { name: "push", usage: "push", icon: "⬆️", description: "Upload local file changes to Caldik" },
  { name: "deploy", usage: "deploy [version] [--machine [SIZE]] [--artifact PATH]", icon: "🌍", description: "Deploy a store or build a marketplace draft" },
  { name: "store", usage: "store list", icon: "🛍️", description: "List your stores", group: true },
  { name: "template", usage: "template <list|create>", icon: "🎨", description: "List or create your marketplace templates" },
  { name: "login", usage: "login [--api URL]", icon: "🔑", description: "Log in to Caldik through your browser", group: true },
  { name: "logout", usage: "logout", icon: "👋", description: "Log out of Caldik" },
  { name: "whoami", usage: "whoami", icon: "👤", description: "Show the account you are logged in to" },
  { name: "version", usage: "version", icon: "🔖", description: "Show the CLI version", group: true },
]

const notes: Record<string, string> = {
  init: "Choose a store, an existing template, or create a template, then download its saved files or keep your local files.",
  dev: "Runs the dev script in package.json and opens this directory in Visual Studio Code when available.",
  pull: "Updates local files to match Caldik, including removing files deleted in Caldik.",
  push: "Updates files saved in Caldik, including removing files deleted locally.",
  deploy: "Stores: run caldik push first to include your latest local changes.\nBuild machines: 2c2g, 4c4g (default), 8c8g or 16c16g. Deploy uses 4c4g automatically.\nUse --machine SIZE or -machine SIZE to override; --machine without a value opens the selector.\nTemplates: uploads local files and builds a draft, using package.json version when omitted.\nPlugins: runs the project build script and uploads dist/plugin.json as a draft. Use --artifact PATH for an existing artifact.\nMarketplace drafts stay private until you submit them for review in Marketplace > Manage (platform admins only).",
  template: 'caldik template list\ncaldik template create "Software Store" --blank\ncaldik template create "Software Store" --store STORE_...\nOmit the source flag to choose interactively. Creation connects this directory without replacing local files.',
  login: "Sign in and approve the OAuth connection in your browser. The CLI receives authorization through a temporary loopback callback.",
}

export function formatHelp(command?: string) {
  const entry = commands.find((item) => item.name === command)
  const flags = "GLOBAL FLAGS\n  -h, --help     Show help\n  -v, --version  Show the CLI version"
  if (entry) {
    return [
      `caldik ${entry.usage}`,
      entry.description,
      notes[entry.name],
      entry.name === "login" ? "OPTIONS\n  --api URL  API URL (defaults to CALDIK_API_URL or https://api.caldik.com)" : undefined,
      flags,
    ].filter(Boolean).join("\n\n")
  }

  const width = Math.max(...commands.map((item) => `caldik ${item.usage}`.length))
  return [
    `caldik - Caldik CLI ${packageJson.version}`,
    "COMMANDS\n" + commands.map((item) =>
      `${item.group ? "\n" : ""}  ${`caldik ${item.usage}`.padEnd(width)}  ${terminal.unicode ? `${item.icon}  ` : ""}${item.description}`,
    ).join("\n"),
    flags,
    "Run caldik <command> --help for command details.",
  ].join("\n\n")
}
