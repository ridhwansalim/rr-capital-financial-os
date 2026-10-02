/**
 * Persist an outbox request ID under a read/write IndexedDB transaction.
 * Multiple tabs may discover the same legacy entry at once; serializing this
 * read/assign/write ensures they all post the same idempotency key.
 */
export async function ensureOfflineRequestId<T extends { id?: number; owner_id: string; request_id?: string }>(
  database: {
    outbox: {
      get(id: number): Promise<T | undefined>
      update(id: number, changes: Partial<T>): Promise<unknown>
    }
    transaction<R>(mode: 'rw', table: unknown, callback: () => Promise<R>): Promise<R>
  },
  id: number,
  ownerId: string,
  createId: () => string = () => crypto.randomUUID()
): Promise<T | undefined> {
  return database.transaction('rw', database.outbox, async () => {
    const current = await database.outbox.get(id)
    if (!current || current.owner_id !== ownerId) return undefined
    if (current.request_id) return current

    const request_id = createId()
    await database.outbox.update(id, { request_id } as Partial<T>)
    return { ...current, request_id }
  })
}
