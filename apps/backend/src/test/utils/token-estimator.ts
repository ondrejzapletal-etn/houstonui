import fs from 'fs'
import path from 'path'

export function estimateTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4))
}

export function writeArtifact(relPath: string, data: string | object) {
  const root = path.resolve(__dirname)
  const outDir = path.join(root, 'test-artifacts')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const full = path.join(outDir, relPath)
  if (typeof data === 'string') fs.writeFileSync(full, data, 'utf8')
  else fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8')
}
