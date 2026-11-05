import { terminal } from "./terminal"

export class DeploymentDisplay {
  private lastPercent = -1
  private lastStage = ""
  private lastPrintedPercent = -1
  private finished = false
  private activeLine = false
  constructor(private output: { write(text: string): unknown } = process.stderr, private capabilities = terminal) {}

  private style(text: string, code: string) { return this.capabilities.color ? `\x1b[${code}m${text}\x1b[0m` : text }
  private line(text: string) {
    if (this.capabilities.interactive) {
      this.output.write(`${this.activeLine ? "\r\x1b[2K" : ""}${text}`)
      this.activeLine = true
    } else this.output.write(`${text}\n`)
  }
  private endLine() {
    if (this.activeLine) { this.output.write("\r\x1b[2K"); this.activeLine = false }
  }
  requesting() { this.line(`  ${this.style("●", "36")} Requesting deployment...`.replace("●", this.capabilities.unicode ? "●" : "*")) }
  accepted() { this.line(`  ${this.style(this.capabilities.unicode ? "●" : "*", "36")} Build accepted`) }
  update(percent: number, stage = "Building") {
    if (this.finished) return
    const value = Math.max(this.lastPercent, Math.max(0, Math.min(99, Math.round(Number.isFinite(percent) ? percent : 0))))
    const label = stage === "Deploying" ? "Deploying" : "Building"
    if (value === this.lastPercent && label === this.lastStage) return
    if (this.capabilities.interactive) {
      const complete = Math.round(value / 100 * 20)
      const bar = (this.capabilities.unicode ? "━" : "#").repeat(complete) + (this.capabilities.unicode ? "─" : "-").repeat(20 - complete)
      this.line(`  ${this.style(this.capabilities.unicode ? "●" : "*", "36")} ${label}  ${this.style(bar, "36")}  ${value}%`)
    } else if (label !== this.lastStage || value - this.lastPrintedPercent >= 10) {
      this.line(`  ${label}  ${value}%`)
      this.lastPrintedPercent = value
    }
    this.lastPercent = value
    this.lastStage = label
  }
  ready(url?: string, seconds?: number | null) {
    if (this.finished) return
    this.endLine()
    this.finished = true
    const duration = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? ` ${this.style(`(${seconds.toFixed(1)}s)`, "2")}` : ""
    this.output.write(`  ${this.style(this.capabilities.unicode ? "✔" : "+", "32")} ${this.style("Deployment ready", "1")}${duration}\n`)
    if (url) this.output.write(`\n  ${this.style("URL", "2")}  ${this.style(url, "36")}\n`)
    this.output.write("\n")
  }
  fail() {
    if (this.finished) return
    this.endLine()
    this.finished = true
    this.output.write(`  ${this.style(this.capabilities.unicode ? "✘" : "x", "31")} Deployment failed\n`)
  }
}
