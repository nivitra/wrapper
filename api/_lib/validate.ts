import type { Context } from 'hono'
import type { z } from 'zod'
import { HttpError } from './http'

export async function readJson<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  const length = Number(c.req.header('content-length') || 0)
  if (length > 1_100_000) throw new HttpError(413, 'Payload too large (1 MB limit)')

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(.') || 'body'}}: ${i.message}`)
      .join('; ')
    throw new HttpError(422, issues || 'Invalid request body')
  }
  return parsed.data
}

export function parseJson<T>(value: unknown): T {
  return value as T
}
