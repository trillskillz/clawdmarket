import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let logoDataUrl: Promise<string> | undefined

export function getBrandLogoDataUrl() {
  logoDataUrl ??= readFile(join(process.cwd(), 'public', 'images', 'clawdmarket-crab.png'))
    .then((image) => `data:image/png;base64,${image.toString('base64')}`)
  return logoDataUrl
}
