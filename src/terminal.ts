/** Classic Windows consoles may lack both the code page and font for Unicode
 * symbols. Use readable equivalents; modern terminals keep the richer output. */
export function terminalCapabilities(platform = process.platform, env: Record<string, string | undefined> = process.env, tty = Boolean(process.stderr.isTTY)) {
  const modernWindows = Boolean(env.WT_SESSION || env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "Hyper" || env.ConEmuANSI === "ON" || env.TERM?.startsWith("xterm"))
  const unicode = env.CALDIK_UNICODE === "1" || (env.CALDIK_UNICODE !== "0" && (platform !== "win32" || modernWindows))
  const interactive = tty && env.TERM !== "dumb"
  return { unicode, interactive, color: interactive && env.NO_COLOR === undefined }
}
export const terminal = terminalCapabilities()
