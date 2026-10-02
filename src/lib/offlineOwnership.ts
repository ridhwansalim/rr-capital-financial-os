type OwnedRecord = { owner_id: string }

export function visibleOfflineItems<T extends OwnedRecord & { sync_status: string }>(
  items: T[] | undefined | null,
  ownerId: string | null
): T[] {
  if (!ownerId || !items) return []
  return items.filter(item => item.owner_id === ownerId && item.sync_status !== 'synced')
}

export function cacheForOwner<T extends OwnedRecord>(cache: T | undefined, ownerId: string | null): T | undefined {
  return ownerId && cache?.owner_id === ownerId ? cache : undefined
}
