import { createInterface } from "node:readline/promises"
import { emitKeypressEvents } from "node:readline"
import { terminal } from "./terminal"

export type SelectionOption<T> = {
  label: string
  value: T
}

export class SelectionCancelledError extends Error {
  constructor() {
    super("Selection cancelled")
    this.name = "SelectionCancelledError"
  }
}

export async function selectOption<T>(message: string, options: SelectionOption<T>[]) {
  if (options.length === 0) throw new Error("No selection options are available")
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Interactive selection requires a terminal")
  }

  emitKeypressEvents(process.stdin)
  const wasRaw = process.stdin.isRaw
  let selected = 0
  let rendered = false

  process.stdout.write(`${message}\n`)

  return await new Promise<T>((resolve, reject) => {
    const render = () => {
      if (rendered) process.stdout.write(`\x1b[${options.length}A`)
      for (let index = 0; index < options.length; index += 1) {
        const marker = index === selected ? (terminal.unicode ? "❯" : ">") : " "
        process.stdout.write(`\r\x1b[2K${marker} ${options[index].label}\n`)
      }
      rendered = true
    }

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress)
      process.stdin.setRawMode(Boolean(wasRaw))
      if (!wasRaw) process.stdin.pause()
    }

    const onKeypress = (_character: string, key: { name?: string, ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup()
        process.stdout.write("Cancelled.\n")
        reject(new SelectionCancelledError())
        return
      }
      if (key.name === "up") {
        selected = (selected - 1 + options.length) % options.length
        render()
        return
      }
      if (key.name === "down") {
        selected = (selected + 1) % options.length
        render()
        return
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup()
        resolve(options[selected].value)
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("keypress", onKeypress)
    render()
  })
}

export async function promptText(message: string, defaultValue?: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Provide the template name in the command when not using an interactive terminal.")
  const input = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await input.question(`${message}${defaultValue ? ` (${defaultValue})` : ""}: `)).trim() || defaultValue || "" }
  finally { input.close() }
}
