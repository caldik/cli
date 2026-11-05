export type StorefrontSnapshot = { storeId: string; apiUrl: string; data: { success: true; store: Record<string, unknown> } }

export async function loadStorefrontSnapshot(storeId: string, apiUrl: string): Promise<StorefrontSnapshot> {
  if (!/^STORE_[a-f0-9]{32}$/i.test(storeId)) throw new Error("Invalid storefront store ID")
  const base = apiUrl.replace(/\/+$/, ""), url = new URL(`${base}/v1/stores/${storeId}`)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid storefront API URL")
  const response = await fetch(url, { headers: { Accept: "application/json", "X-Caldik-Public-Request": "1" }, redirect: "error", signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Public store profile returned HTTP ${response.status}`)
  const body = await response.json() as { success?: boolean; store?: Record<string, unknown> }
  const store = body.store
  if (body.success !== true || !store || typeof store.name !== "string" || typeof store.description !== "string" ||
    !(store.averageRating === null || typeof store.averageRating === "number") ||
    !Number.isSafeInteger(store.orders) || Number(store.orders) < 0 || !Number.isSafeInteger(store.customers) || Number(store.customers) < 0 ||
    !store.socials || typeof store.socials !== "object") throw new Error("Invalid public store profile")
  const socials = Object.fromEntries(["instagram", "tiktok", "x", "youtube", "discord", "telegram"].map(key => {
    const value = (store.socials as Record<string, unknown>)[key]
    if (value !== null && typeof value !== "string") throw new Error("Invalid public store socials")
    return [key, value]
  }))
  return { storeId, apiUrl: base, data: { success: true, store: { name: store.name, description: store.description,
    ...(typeof store.contactEmail === "string" ? { contactEmail: store.contactEmail } : {}),
    averageRating: store.averageRating, orders: store.orders, customers: store.customers, socials } } }
}

export function snapshotEnvironment(snapshot: StorefrontSnapshot) {
  const json = JSON.stringify(snapshot)
  if (new TextEncoder().encode(json).byteLength > 65_536) throw new Error("Public store profile is too large")
  return { CALDIK_STORE_ID: snapshot.storeId, CALDIK_API_URL: snapshot.apiUrl, CALDIK_STORE_DATA: json,
    NEXT_PUBLIC_CALDIK_STORE_ID: snapshot.storeId, NEXT_PUBLIC_CALDIK_API_URL: snapshot.apiUrl, NEXT_PUBLIC_CALDIK_STORE_DATA: json,
    VITE_CALDIK_STORE_ID: snapshot.storeId, VITE_CALDIK_API_URL: snapshot.apiUrl, VITE_CALDIK_STORE_DATA: json,
    PUBLIC_CALDIK_STORE_ID: snapshot.storeId, PUBLIC_CALDIK_API_URL: snapshot.apiUrl, PUBLIC_CALDIK_STORE_DATA: json }
}
