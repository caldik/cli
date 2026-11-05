type DeploymentProgressEvent = {
  type?: string
  deploymentId?: string
  stage?: "Initializing" | "Installing" | "Building" | "Deploying" | "Complete"
  progress?: number
  status?: "running" | "complete" | "failed"
  message?: string
  buildDurationSeconds?: number | null
}

export async function waitForDeploymentProgress(websocketUrl: string, deploymentId: string,
  onProgress: (progress: number, stage: string) => void = () => {}) {
  return await new Promise<DeploymentProgressEvent>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl)
    let settled = false
    const timeout = setTimeout(() => finish(new Error("Deployment timed out")), 60 * 60 * 1000)
    timeout.unref?.()

    function finish(error?: Error, result?: DeploymentProgressEvent) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { socket.close(1000, "Complete") } catch { /* Connection may already be closed. */ }
      if (error) {
        reject(error)
      }
      else {
        resolve(result!)
      }
    }

    socket.addEventListener("message", (event) => {
      if (settled) return
      let update: DeploymentProgressEvent
      try { update = JSON.parse(String(event.data)) } catch { return }
      if (!update || typeof update !== "object") return
      if (update.type !== "deployment:progress" || update.deploymentId !== deploymentId) return
      const stage = update.stage || "Initializing"
      const progress = typeof update.progress === "number" ? update.progress : 0
      if (update.status === "failed") {
        finish(new Error(`${stage} failed`))
        return
      }
      if (update.status === "complete" || stage === "Complete") {
        finish(undefined, update)
        return
      }
      onProgress(progress, stage)
    })
    socket.addEventListener("error", () => {
      finish(new Error("Connection failed"))
    })
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Stream closed before completion"))
    })
  })
}
