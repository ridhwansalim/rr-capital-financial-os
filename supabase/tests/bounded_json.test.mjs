import assert from "node:assert/strict"
import test from "node:test"
import { readBoundedJson } from "../functions/_shared/boundedJson.ts"

test("bounded JSON accepts a valid body up to the byte limit", async () => {
  const request = new Request("https://local.invalid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "configure" }),
  })

  assert.deepEqual(await readBoundedJson(request, 64), {
    ok: true,
    value: { action: "configure" },
  })
})

test("bounded JSON rejects an oversized declared content length before reading", async () => {
  const request = new Request("https://local.invalid", {
    method: "POST",
    headers: { "content-length": "100" },
    body: "{}",
  })

  assert.deepEqual(await readBoundedJson(request, 16), { ok: false, status: 413 })
})

test("bounded JSON stops a chunked body when streamed bytes exceed the limit", async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":"too large"}'))
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request("https://local.invalid", { method: "POST", body, duplex: "half" })

  assert.deepEqual(await readBoundedJson(request, 8), { ok: false, status: 413 })
  assert.equal(cancelled, true)
})

test("bounded JSON rejects malformed, empty, and invalid UTF-8 bodies", async () => {
  const malformed = new Request("https://local.invalid", { method: "POST", body: "{" })
  const empty = new Request("https://local.invalid", { method: "POST", body: "" })
  const invalidUtf8 = new Request("https://local.invalid", {
    method: "POST",
    body: new Uint8Array([0xff, 0xfe]),
  })

  assert.deepEqual(await readBoundedJson(malformed, 16), { ok: false, status: 400 })
  assert.deepEqual(await readBoundedJson(empty, 16), { ok: false, status: 400 })
  assert.deepEqual(await readBoundedJson(invalidUtf8, 16), { ok: false, status: 400 })
})

test("bounded JSON rejects malformed content-length headers", async () => {
  const request = new Request("https://local.invalid", {
    method: "POST",
    headers: { "content-length": "many" },
    body: "{}",
  })

  assert.deepEqual(await readBoundedJson(request, 16), { ok: false, status: 400 })
})
