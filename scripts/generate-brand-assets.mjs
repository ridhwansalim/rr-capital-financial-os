import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDir = path.join(root, 'public')
const assetsDir = path.join(root, 'src/assets/brand')
const stripBackground = svg => svg.replace(/\s*<rect\b(?=[^>]*fill=["']#F8F9FA["'])[^>]*\/?>(?:<\/rect>)?/i, '')
const whiteArtwork = svg => stripBackground(svg).replace(
  /(stop-color|fill|stroke)=(['"])#[0-9a-f]{3,8}\2/gi,
  (_match, property) => `${property}="#ffffff"`
)

const logoInput = stripBackground(await readFile(path.join(publicDir, 'rr-logo.svg'), 'utf8'))
const faviconInput = stripBackground(await readFile(path.join(publicDir, 'rr-favicon.svg'), 'utf8'))
const logoWhite = whiteArtwork(logoInput)
const faviconWhite = whiteArtwork(faviconInput)
const logoDark = logoWhite.replace(
  /(<svg\b[^>]*>)/i,
  '$1\n  <rect width="800" height="600" rx="24" fill="#cc785c" />'
)

const svgAssets = new Map([
  ['rr-logo.svg', logoInput],
  ['rr-logo-inverted.svg', logoWhite],
  ['rr-logo-dark.svg', logoDark],
  ['rr-favicon.svg', faviconInput],
  ['rr-favicon-inverted.svg', faviconWhite],
  // Keep existing application and Android tooling paths compatible.
  ['rr-logo-transparent.svg', logoInput],
  ['rr-logo-inverted-white.svg', logoWhite],
  ['rr-icon-transparent.svg', faviconInput],
  ['rr-icon-inverted-white.svg', faviconWhite],
])

await mkdir(publicDir, { recursive: true })
await mkdir(assetsDir, { recursive: true })
for (const [filename, svg] of svgAssets) {
  await writeFile(path.join(publicDir, filename), svg)
  await writeFile(path.join(assetsDir, filename), svg)
}

const browser = await chromium.launch({ headless: true })

async function render(svg, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:transparent"><img alt="" style="display:block;width:100%;height:100%;object-fit:contain" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`)
  await page.locator('img').evaluate(img => img.decode())
  const png = await page.locator('img').screenshot({ omitBackground: true })
  await page.close()
  return png
}

function makeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    directory[entry] = size === 256 ? 0 : size
    directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([directory, ...images.map(image => image.png)])
}

try {
  const pngAssets = new Map()
  for (const [prefix, svg] of [
    ['rr-logo', logoInput],
    ['rr-logo-inverted', logoWhite],
    ['rr-logo-dark', logoDark],
    ['rr-favicon', faviconInput],
    ['rr-favicon-inverted', faviconWhite],
  ]) {
    for (const size of [32, 64, 192, 512]) {
      const png = await render(svg, size)
      pngAssets.set(`${prefix}-${size}.png`, png)
      await writeFile(path.join(publicDir, `${prefix}-${size}.png`), png)
      await writeFile(path.join(assetsDir, `${prefix}-${size}.png`), png)
      if (size === 512) {
        const alias = `${prefix}.png`
        await writeFile(path.join(publicDir, alias), png)
        await writeFile(path.join(assetsDir, alias), png)
      }
    }
  }

  const icoLight = makeIco(await Promise.all([16, 32, 48].map(async size => ({ size, png: await render(faviconInput, size) }))))
  const icoDark = makeIco(await Promise.all([16, 32, 48].map(async size => ({ size, png: await render(faviconWhite, size) }))))
  const icoFiles = new Map([
    ['favicon.ico', icoLight],
    ['favicon-inverted.ico', icoDark],
    ['rr-favicon.ico', icoLight],
    ['rr-capital.ico', icoLight],
    ['rr-favicon-inverted-white.ico', icoDark],
    ['rr-capital-inverted-white.ico', icoDark],
  ])
  for (const [filename, bytes] of icoFiles) {
    await writeFile(path.join(publicDir, filename), bytes)
    await writeFile(path.join(assetsDir, filename), bytes)
  }
} finally {
  await browser.close()
}
