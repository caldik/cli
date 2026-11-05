import { terminal } from "./terminal"
const frames = terminal.unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["-", "\\", "|", "/"]
const { interactive } = terminal
const colored = (value: string, color: number) => terminal.color ? `\x1b[${color}m${value}\x1b[0m` : value

function clearLine() {
  if (interactive) process.stderr.write("\r\x1b[2K")
}

export class Spinner {
  private frame = 0
  private timer?: ReturnType<typeof setInterval>
  private text: string

  constructor(text: string) {
    this.text = text
  }

  start() {
    if (!interactive) {
      console.error(`... ${this.text}`)
      return this
    }
    this.render()
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % frames.length
      this.render()
    }, 80)
    this.timer.unref?.()
    return this
  }

  update(text: string) {
    this.text = text
    if (interactive) this.render()
  }

  private render() {
    clearLine()
    process.stderr.write(`${colored(frames[this.frame], 36)} ${this.text}`)
  }

  stop(symbol?: string, text?: string) {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (text) this.text = text
    if (interactive) {
      clearLine()
      if (symbol) process.stderr.write(`${symbol} ${this.text}\n`)
    }
    else if (symbol) {
      console.error(`${symbol} ${this.text}`)
    }
  }

  succeed(text?: string) {
    this.stop(colored(terminal.unicode ? "✔" : "OK", 32), text)
  }

  fail(text?: string) {
    this.stop(colored(terminal.unicode ? "✖" : "X", 31), text)
  }
}

export class ProgressBar {
  private lastPercent = -1
  private lastText = ""

  constructor(private text: string, private width = 28) {}

  update(percent: number, text = this.text) {
    const value = Math.max(0, Math.min(100, Math.round(percent)))
    this.text = text
    if (!interactive) {
      if (text !== this.lastText || value === 100 || value - this.lastPercent >= 10) {
        console.error(`[${value.toString().padStart(3)}%] ${text}`)
        this.lastPercent = value
        this.lastText = text
      }
      return
    }
    const completed = Math.round((value / 100) * this.width)
    const bar = `${(terminal.unicode ? "█" : "#").repeat(completed)}${(terminal.unicode ? "░" : "-").repeat(this.width - completed)}`
    clearLine()
    process.stderr.write(`${colored(bar, 36)} ${value.toString().padStart(3)}% ${text}`)
    this.lastPercent = value
    this.lastText = text
  }

  complete(text = this.text) {
    this.update(100, text)
    if (interactive) process.stderr.write("\n")
  }

  fail(text: string) {
    clearLine()
    process.stderr.write(`${colored(terminal.unicode ? "✖" : "X", 31)} ${text}\n`)
  }
}
