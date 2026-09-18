/**
 * Route visibility audit.
 *
 * Walks every controller in the source tree and asserts that no route is marked
 * `@Public()` unless it appears in `PUBLIC_ROUTES`.
 *
 * Why source scanning rather than booting the Nest app: this must run without a
 * database, Key Vault or OpenAI key, and it must also catch a stray `@Public()`
 * that the guard would already neutralise at runtime – the decorator itself is
 * the thing we want to keep out of the codebase, because it signals intent that
 * no longer matches behaviour.
 *
 * Background: a security audit found 61 routes carrying `@Public()`, every one
 * of them resolving the caller to a single shared `dev-user-placeholder`
 * identity – including `POST /proposals/:id/approve`, which sends real Gmail and
 * Slack messages. This test is what stops that from coming back.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { PUBLIC_ROUTES } from './global-auth.guard'

const SRC_ROOT = path.join(__dirname, '..')
const ROUTE_DECORATOR = /^\s*@(Get|Post|Put|Delete|Patch)\(/
const PUBLIC_DECORATOR = /@Public\(\)/
const CLASS_DECL = /export class (\w+)/

interface DiscoveredRoute {
  file: string
  controller: string
  handler: string
  method: string
  isPublic: boolean
}

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(full)
    if (!entry.name.endsWith('.ts')) return []
    if (entry.name.includes('.spec.')) return []
    return [full]
  })
}

function discoverRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []

  for (const file of listTsFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes('@Controller(')) continue

    const lines = source.split('\n')
    const relative = path.relative(SRC_ROOT, file).split(path.sep).join('/')

    // A @Public() adjacent to @Controller() opens the whole controller
    const controllerLine = lines.findIndex((l) => l.includes('@Controller('))
    const controllerIsPublic = lines
      .slice(Math.max(0, controllerLine - 4), controllerLine + 1)
      .some((l) => PUBLIC_DECORATOR.test(l))

    const classMatch = source.match(CLASS_DECL)
    const controller = classMatch ? classMatch[1] : relative

    lines.forEach((line, i) => {
      if (!ROUTE_DECORATOR.test(line)) return

      // Expand to the full contiguous decorator/comment block above the route
      // decorator, so a @Public() written before @Get is not missed.
      let start = i
      while (start > 0 && /^\s*(@|\/\/|\*|\/\*)/.test(lines[start - 1])) start--

      // ...and down to the handler signature that terminates the block.
      let end = i
      let handler = `line${i + 1}`
      for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
        end = j
        const sig = lines[j].match(/^\s*(?:async\s+)?([a-zA-Z_]\w*)\s*\(/)
        if (sig) {
          handler = sig[1]
          break
        }
      }

      const block = lines.slice(start, end + 1)
      routes.push({
        file: relative,
        controller,
        handler,
        method: line.trim(),
        isPublic: controllerIsPublic || block.some((l) => PUBLIC_DECORATOR.test(l)),
      })
    })
  }

  return routes
}

describe('route visibility audit', () => {
  const routes = discoverRoutes()

  it('discovers the controller route table', () => {
    // Sanity check: if the scanner silently finds nothing, the assertions below
    // would pass vacuously.
    expect(routes.length).toBeGreaterThan(50)
  })

  it('marks no route @Public() unless it is in PUBLIC_ROUTES', () => {
    const unexpected = routes
      .filter((r) => r.isPublic)
      .filter((r) => !PUBLIC_ROUTES.has(`${r.controller}.${r.handler}`))
      .map((r) => `${r.controller}.${r.handler} – ${r.method} (${r.file})`)

    expect(unexpected).toEqual([])
  })

  it('keeps the public surface to the documented allow-list', () => {
    const publicRoutes = routes
      .filter((r) => r.isPublic)
      .map((r) => `${r.controller}.${r.handler}`)
      .sort()

    expect(publicRoutes).toEqual([...PUBLIC_ROUTES].sort())
  })

  it('has every PUBLIC_ROUTES entry backed by a real route', () => {
    // Catches drift the other way: an allow-list entry left behind after a
    // handler is renamed or deleted.
    const actual = new Set(routes.map((r) => `${r.controller}.${r.handler}`))
    const stale = [...PUBLIC_ROUTES].filter((entry) => !actual.has(entry))

    expect(stale).toEqual([])
  })
})
