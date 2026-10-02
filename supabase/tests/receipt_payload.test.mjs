import assert from "node:assert/strict"
import test from "node:test"
import { readReceiptPayload, maxReceiptImageBytes } from "../functions/_shared/receiptPayload.ts"

function requestWithBody(value) {
  return new Request("https://local.invalid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })
}

test("receipt payload accepts a supported image and returns only validated fields", async () => {
  const result = await readReceiptPayload(requestWithBody({
    mimeType: "image/jpeg",
    imageBase64: "AQID",
    ignored: "untrusted extra field",
  }))

  assert.deepEqual(result, {
    ok: true,
    value: { mimeType: "image/jpeg", imageBase64: "AQID" },
  })
})

test("receipt payload rejects null, arrays, unsupported types, and malformed base64", async () => {
  for (const body of [
    null,
    [],
    { mimeType: "text/plain", imageBase64: "AQID" },
    { mimeType: "image/jpeg", imageBase64: "not base64!" },
  ]) {
    assert.deepEqual(await readReceiptPayload(requestWithBody(body)), { ok: false, status: 400 })
  }
})

test("receipt payload enforces the decoded image size limit", async () => {
  const imageBase64 = Buffer.alloc(maxReceiptImageBytes + 1).toString("base64")
  const result = await readReceiptPayload(requestWithBody({ mimeType: "image/jpeg", imageBase64 }))

  assert.deepEqual(result, { ok: false, status: 413 })
})

test("receipt payload rejects an oversized chunked body before buffering it all", async () => {
  const smallPrefix = new TextEncoder().encode('{"mimeType":"image/jpeg","imageBase64":"')
  const largeChunk = new Uint8Array(11_500_000)
  largeChunk.fill(65)
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(smallPrefix)
      controller.enqueue(largeChunk)
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request("https://local.invalid", { method: "POST", body, duplex: "half" })

  assert.deepEqual(await readReceiptPayload(request), { ok: false, status: 413 })
  assert.equal(cancelled, true)
})
