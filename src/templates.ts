import { apiRequest } from "./api"

export type MarketplaceTemplate = { id: string; name: string; slug: string; status: "draft" | "pending_review" | "approved" | "rejected" | "archived"; isDefault?: boolean; isOfficial?: boolean }
export function templateCreateOptions(args: string[]) {
  const names: string[] = []
  let blank = false, sourceStoreId: string | undefined
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--blank") blank = true
    else if (value === "--store") {
      const id = args[++index]
      if (!id || id.startsWith("-") || sourceStoreId) throw new Error("Provide one store ID after --store.")
      sourceStoreId = id
    } else if (value.startsWith("-")) throw new Error(`Unknown template option: ${value}`)
    else names.push(value)
  }
  if (blank && sourceStoreId) throw new Error("Choose --blank or --store, not both.")
  const name = names.join(" ").trim()
  if (name.length > 120) throw new Error("Template names must be at most 120 characters.")
  return { name: name || undefined, blank, sourceStoreId }
}
export async function requestTemplateCreation(apiUrl: string, input: { name: string; sourceStoreId?: string }) {
  const name = input.name.trim()
  if (!name || name.length > 120) throw new Error("Enter a template name between 1 and 120 characters.")
  const result = await apiRequest<{ template: MarketplaceTemplate }>(apiUrl, "/v1/users/developers/marketplace", { method: "POST", body: { name, ...(input.sourceStoreId ? { sourceStoreId: input.sourceStoreId } : {}) } })
  if (!result?.template?.id) throw new Error("The API did not return the created template.")
  return result.template
}
