/**
 * Loaded by jest.integration.config.js via setupFiles before any test runs.
 * Reads .env.test from the project root and injects variables into process.env.
 * Existing env vars (e.g. set in CI) are never overwritten.
 */
import * as fs from 'fs'
import * as path from 'path'

const envFile = path.join(process.cwd(), '.env.test')

if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n')
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        if (key && !(key in process.env)) {
            process.env[key] = val
        }
    }
}
