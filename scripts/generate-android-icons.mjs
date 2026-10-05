import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const iconPath = path.join(root, 'public/rr-favicon.svg')
const source = await readFile(iconPath, 'utf8')
const foreground = source
  .replace(/<rect\b[^>]*\/>/i, '')
  // Android adaptive launchers mask the outer 1/3 of the foreground. Scale
  // the mark into the centered safe zone so it remains intact under all masks.
  .replace('<g transform="translate(-22, -22) scale(0.75)"', '<g transform="translate(128 128) scale(0.82) translate(-128 -128) translate(-22, -22) scale(0.75)"')
const browser = await chromium.launch({ headless: true })

async function render(svg, size, output) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`)
  await page.locator('img').evaluate(img => img.decode())
  await page.locator('img').screenshot({ path: output, omitBackground: true })
  await page.close()
}

try {
  // Keep high-resolution source renders available for stores, previews, and
  // future native packaging without relying on a browser to rasterize at build time.
  const highResDir = path.join(root, 'public/android-icons')
  await mkdir(highResDir, { recursive: true })
  await render(source, 512, path.join(highResDir, 'rr-capital-icon-512.png'))
  await render(source, 1024, path.join(highResDir, 'rr-capital-icon-1024.png'))

  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = path.join(root, `android/app/src/main/res/mipmap-${density}`)
    await mkdir(dir, { recursive: true })
    await render(source, size, path.join(dir, 'ic_launcher.png'))
    await render(source, size, path.join(dir, 'ic_launcher_round.png'))
  }
  const adaptiveDir = path.join(root, 'android/app/src/main/res/mipmap-xxxhdpi')
  await render(foreground, 432, path.join(adaptiveDir, 'ic_launcher_foreground.png'))
  const splashDir = path.join(root, 'android/app/src/main/res/drawable-nodpi')
  await mkdir(splashDir, { recursive: true })
  await render(foreground, 512, path.join(splashDir, 'rr_splash_logo.png'))
} finally {
  await browser.close()
}
