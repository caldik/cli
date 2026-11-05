import spawn from "cross-spawn"
import which from "which"
import type { SpawnOptions } from "node:child_process"
import { setTimeout } from "node:timers/promises"

export const sleep = (milliseconds: number) => setTimeout(milliseconds)
export const findExecutable = (name: string) => which.sync(name, { nothrow: true })

export function spawnCommand(command: string[], options: SpawnOptions = {}) {
  // cross-spawn also handles npm/pnpm/VS Code's .cmd launchers on Windows.
  const child = spawn(command[0]!, command.slice(1), { windowsHide: true, stdio: "inherit", ...options })
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143)))
  })
  return { exited, kill() { child.kill() } }
}

export function launchCommand(command: string[]) {
  const child = spawn(command[0]!, command.slice(1), { windowsHide: true, stdio: "ignore", detached: true })
  child.on("error", () => {})
  child.unref()
}
