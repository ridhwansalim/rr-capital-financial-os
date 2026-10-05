import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const iconPath = path.join(root, 'public/rr-favicon.svg')
const whitePath = path.join(root, 'public/rr-favicon-inverted.svg')
const source = await readFile(iconPath, 'utf8')
const whiteSource = await readFile(whitePath, 'utf8')

const flatten = svg => svg
  .replace(/\s*<filter\b[\s\S]*?<\/filter>/i, '')
  .replace(/\sfilter="url\(#shadow\)"/g, '')
const coralArtwork = flatten(source)
  .replace(/#1B2A47|#0A1128/gi, '#cc785c')
const whiteArtwork = flatten(whiteSource)
  .replace(/#(?:1B2A47|0A1128|cc785c)/gi, '#ffffff')
const monochromeArtwork = coralArtwork.replace(/#cc785c/gi, '#000000')

const scaleToSafeZone = svg => svg.replace(
  '<g transform="translate(-22, -22) scale(0.75)"',
  '<g transform="translate(128 128) scale(0.82) translate(-128 -128) translate(-22, -22) scale(0.75)"'
)
const coralForeground = scaleToSafeZone(coralArtwork)
const whiteForeground = scaleToSafeZone(whiteArtwork)
const monochromeForeground = scaleToSafeZone(monochromeArtwork)

const addBackground = (svg, color) => svg.replace(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%">',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%"><rect width="256" height="256" fill="${color}" rx="56"/>`
)
const lightIconSvg = addBackground(coralArtwork, '#ffffff')
const darkIconSvg = addBackground(whiteArtwork, '#cc785c')
const creamIconSvg = addBackground(coralArtwork, '#faf9f5')
const monochromeIconSvg = addBackground(monochromeArtwork, '#ffffff')
const browser = await chromium.launch({ headless: true })

async function render(svg, size, output) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`)
  await page.locator('img').evaluate(img => img.decode())
  await page.locator('img').screenshot({ path: output, omitBackground: true })
  await page.close()
}

try {
  const highResDir = path.join(root, 'public/android-icons')
  await mkdir(highResDir, { recursive: true })
  await render(lightIconSvg, 512, path.join(highResDir, 'rr-capital-icon-512.png'))
  await render(lightIconSvg, 1024, path.join(highResDir, 'rr-capital-icon-1024.png'))
  await render(darkIconSvg, 512, path.join(highResDir, 'rr-capital-icon-dark-512.png'))
  await render(darkIconSvg, 1024, path.join(highResDir, 'rr-capital-icon-dark-1024.png'))
  await render(creamIconSvg, 512, path.join(highResDir, 'rr-capital-icon-cream-512.png'))
  await render(creamIconSvg, 1024, path.join(highResDir, 'rr-capital-icon-cream-1024.png'))
  await render(monochromeIconSvg, 512, path.join(highResDir, 'rr-capital-icon-monochrome-512.png'))
  await render(monochromeIconSvg, 1024, path.join(highResDir, 'rr-capital-icon-monochrome-1024.png'))

  const densityScale = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [density, scale] of Object.entries(densityScale)) {
    const legacySize = 48 * scale
    const foregroundSize = 108 * scale
    const dayDir = path.join(root, `android/app/src/main/res/mipmap-${density}`)
    const nightDir = path.join(root, `android/app/src/main/res/mipmap-night-${density}`)
    await mkdir(dayDir, { recursive: true })
    await mkdir(nightDir, { recursive: true })

    await render(lightIconSvg, legacySize, path.join(dayDir, 'ic_launcher.png'))
    await render(lightIconSvg, legacySize, path.join(dayDir, 'ic_launcher_round.png'))
    await render(coralForeground, foregroundSize, path.join(dayDir, 'ic_launcher_foreground.png'))
    await render(monochromeForeground, foregroundSize, path.join(dayDir, 'ic_launcher_monochrome.png'))
    await render(creamIconSvg, legacySize, path.join(dayDir, 'ic_launcher_light.png'))
    await render(creamIconSvg, legacySize, path.join(dayDir, 'ic_launcher_light_round.png'))
    await render(coralForeground, foregroundSize, path.join(dayDir, 'ic_launcher_light_foreground.png'))
    await render(darkIconSvg, legacySize, path.join(dayDir, 'ic_launcher_dark.png'))
    await render(darkIconSvg, legacySize, path.join(dayDir, 'ic_launcher_dark_round.png'))
    await render(whiteForeground, foregroundSize, path.join(dayDir, 'ic_launcher_dark_foreground.png'))
    await render(monochromeIconSvg, legacySize, path.join(dayDir, 'ic_launcher_monochrome.png'))
    await render(monochromeForeground, foregroundSize, path.join(dayDir, 'ic_launcher_mono_layer.png'))

    await render(darkIconSvg, legacySize, path.join(nightDir, 'ic_launcher.png'))
    await render(darkIconSvg, legacySize, path.join(nightDir, 'ic_launcher_round.png'))
    await render(whiteForeground, foregroundSize, path.join(nightDir, 'ic_launcher_foreground.png'))
    // Android's themed icon layer is intentionally a single flat silhouette;
    // the launcher applies the Material You tint at draw time.
    await render(monochromeForeground, foregroundSize, path.join(nightDir, 'ic_launcher_monochrome.png'))
  }

  const resourceRoot = path.join(root, 'android/app/src/main/res')
  const adaptiveIcon = (background, foreground, monochrome = '@mipmap/ic_launcher_mono_layer') => `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="${background}" />\n    <foreground android:drawable="${foreground}" />\n    <monochrome android:drawable="${monochrome}" />\n</adaptive-icon>\n`
  const adaptiveDir = path.join(resourceRoot, 'mipmap-anydpi-v26')
  await mkdir(adaptiveDir, { recursive: true })
  await writeFile(path.join(adaptiveDir, 'ic_launcher_dark.xml'), adaptiveIcon('@color/ic_launcher_dark_background', '@mipmap/ic_launcher_dark_foreground'))
  await writeFile(path.join(adaptiveDir, 'ic_launcher_light.xml'), adaptiveIcon('@color/ic_launcher_light_background', '@mipmap/ic_launcher_light_foreground'))
  await writeFile(path.join(adaptiveDir, 'ic_launcher_monochrome.xml'), adaptiveIcon('@color/ic_launcher_monochrome_background', '@mipmap/ic_launcher_mono_layer', '@mipmap/ic_launcher_mono_layer'))

  await writeFile(path.join(resourceRoot, 'values', 'launcher_icon_colors.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_dark_background">#cc785c</color>\n    <color name="ic_launcher_light_background">#faf9f5</color>\n    <color name="ic_launcher_monochrome_background">#ffffff</color>\n</resources>\n`)

  const splashDir = path.join(root, 'android/app/src/main/res/drawable-nodpi')
  await mkdir(splashDir, { recursive: true })
  await render(coralForeground, 512, path.join(splashDir, 'rr_splash_logo.png'))
} finally {
  await browser.close()
}
