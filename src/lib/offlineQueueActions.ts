export type DiscardableOutboxItem = { owner_id: string; sync_status: string }

/** Delete only an owner's failed item, rechecking state inside an IDB write. */
export async function discardFailedOutboxItem<T extends DiscardableOutboxItem>(
  database: {
    outbox: {
      get(id: number): Promise<T | undefined>
      delete(id: number): Promise<unknown>
    }
    transaction<R>(mode: 'rw', table: unknown, callback: () => Promise<R>): Promise<R>
  },
  id: number,
  ownerId: string
): Promise<boolean> {
  return database.transaction('rw', database.outbox, async () => {
    const item = await database.outbox.get(id)
    if (!item || item.owner_id !== ownerId || item.sync_status !== 'failed') return false
    await database.outbox.delete(id)
    return true
  })
}
