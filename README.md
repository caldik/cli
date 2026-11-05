# Caldik CLI

The Caldik CLI lets you develop, sync, and deploy Caldik stores, marketplace templates, and plugins.

## Installation

```bash
npm install -g @caldik/cli
```

## Getting started

```bash
caldik login
caldik init
caldik dev
```

## Commands

| Command | Description |
|---|---|
| `caldik login` | Sign in to Caldik |
| `caldik logout` | Sign out |
| `caldik whoami` | View current account |
| `caldik init` | Connect a local project |
| `caldik dev` | Start local development |
| `caldik pull` | Download cloud changes |
| `caldik push` | Upload local changes |
| `caldik deploy` | Deploy your project |
| `caldik store list` | List your stores |
| `caldik template list` | List your templates |
| `caldik --help` | View all commands |

## Development

Start your local development server:

```bash
caldik dev
```

For storefronts using the Caldik SDK:

```bash
bun add @caldik/client
```

Supports Next.js, Vite, Vinext, and Astro.

## Syncing files

Download changes from Caldik:

```bash
caldik pull
```

Upload local changes:

```bash
caldik push
```

## Deployment

Deploy your store:

```bash
caldik push
caldik deploy
```

Select a build machine:

```bash
caldik deploy --machine
```

Or specify one directly:

```bash
caldik deploy --machine 2c2g
caldik deploy --machine 4c4g
caldik deploy --machine 8c8g
caldik deploy --machine 16c16g
```

Default: `4c4g` (4 vCPU, 4 GiB RAM).

## Marketplace templates

Create or connect a template project:

```bash
caldik init
```

Sync and build a draft:

```bash
caldik pull
caldik push
caldik deploy 1.0.0
```

You can omit the version if it's defined in `package.json`.

Submit drafts through **Marketplace > Manage > Submit for review**.

## Plugins

Build and deploy a plugin:

```bash
caldik deploy
```

Deploy an existing artifact:

```bash
caldik deploy --artifact dist/plugin.json
```

Requires Bun and `caldik.plugin.ts`.

## Help

```bash
caldik --help
caldik <command> --help
```
