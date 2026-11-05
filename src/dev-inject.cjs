// Loaded in the framework's existing Node process. No proxy or second listener.
const { Server } = require("node:http")
const originalEmit = Server.prototype.emit
const marker = Symbol.for("caldik.store-data.injected")
let script
try {
  const snapshot = JSON.parse(process.env.CALDIK_STORE_DATA || "null")
  if (snapshot?.data?.store) {
    const json = JSON.stringify({ store: snapshot.data.store }).replace(/[<>&\u007f-\uffff]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
    script = Buffer.from(`<script id="store-data" type="application/json">${json}</script>`)
  }
} catch { /* The SDK can use normal requests when the snapshot is unavailable. */ }

if (script && !Server.prototype[marker]) {
  Server.prototype[marker] = true
  Server.prototype.emit = function (event, ...args) {
    if (event === "request") {
      const [request, response] = args
      if (!request.headers.accept || /text\/html|\*\/\*/.test(request.headers.accept)) {
        request.headers["accept-encoding"] = "identity"
        delete request.headers["if-none-match"]
        delete request.headers["if-modified-since"]
        inject(response)
      }
    }
    return originalEmit.call(this, event, ...args)
  }
}

function inject(response) {
  if (response[marker]) return
  response[marker] = true
  const write = response.write, end = response.end, writeHead = response.writeHead
  let prefix = Buffer.alloc(0), finished = false
  const eligible = () => response.statusCode === 200 &&
    String(response.getHeader("content-type") || "").toLowerCase().includes("text/html") &&
    !response.getHeader("content-encoding")
  response.writeHead = function (status, reason, headers) {
    const supplied = typeof reason === "string" ? headers : reason
    if (supplied) {
      const entries = Array.isArray(supplied)
        ? Array.from({ length: supplied.length / 2 }, (_, index) => [supplied[index * 2], supplied[index * 2 + 1]])
        : Object.entries(supplied)
      const grouped = new Map()
      for (const [key, value] of entries) {
        const name = key.toLowerCase(), values = grouped.get(name) || []
        grouped.set(name, values.concat(value))
      }
      for (const [key, values] of grouped) this.setHeader(key, values.length === 1 ? values[0] : values)
    }
    this.statusCode = status
    if (eligible()) {
      for (const name of ["content-length", "etag", "last-modified"]) this.removeHeader(name)
      this.setHeader("cache-control", "no-store")
    }
    return typeof reason === "string" ? writeHead.call(this, status, reason) : writeHead.call(this, status)
  }
  function transform(chunk, encoding, final) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || "", encoding)
    if (finished) return bytes
    if (!eligible()) { finished = true; return bytes }
    prefix = Buffer.concat([prefix, bytes])
    const head = /<head(?:\s[^>]*)?>/i.exec(prefix.toString("latin1"))
    if (head) {
      const offset = head.index + head[0].length
      const result = Buffer.concat([prefix.subarray(0, offset), script, prefix.subarray(offset)])
      prefix = Buffer.alloc(0); finished = true
      return result
    }
    if (final || prefix.length >= 65_536) {
      const result = prefix
      prefix = Buffer.alloc(0); finished = true
      return result
    }
    return null
  }
  response.write = function (chunk, encoding, callback) {
    if (typeof encoding === "function") { callback = encoding; encoding = undefined }
    const bytes = transform(chunk, encoding, false)
    if (!bytes) { if (callback) queueMicrotask(callback); return true }
    return write.call(this, bytes, callback)
  }
  response.end = function (chunk, encoding, callback) {
    if (typeof chunk === "function") { callback = chunk; chunk = undefined }
    if (typeof encoding === "function") { callback = encoding; encoding = undefined }
    return end.call(this, transform(chunk, encoding, true), callback)
  }
}
