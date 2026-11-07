import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ownedDeck } from '../_lib/access'
import { requireCreator, requireUser, type AppEnv } from '../_lib/auth'
import { db } from '../_lib/db'
import { HttpError } from '../_lib/http'
import { presignGet, putObject } from '../_lib/r2'
import { hasDataImage, slideSchema } from '../_lib/schemas'
import { readJson } from '../_lib/validate'
import { assets, deckExports } from '../../db/schema'
import { exportPptxBuffer } from '../../src/export/pptx'
import type { Deck, DeckSettings, Slide } from '../../src/model/types'

const routes = new Hono<AppEnv>()

const exportPayload = z.object({
  deckId: z.string().uuid(),
  deck: z.object({
    id: z.string().min(1).max(80),
    title: z.string().max(200),
    subtitle: z.string().max(400).default(''),
    theme: z.string().max(40),
    archetype: z.string().max(40),
    slides: z.array(slideSchema).min(1).max(200),
    settings: z.record(z.string(), z.unknown()),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  }),
})

routes.post('/pptx', requireCreator, async (c) => {
  const userId = c.get('userId')
  const body = await readJson(c, exportPayload)
  const saved = await ownedDeck(userId, body.deckId)

  if (body.deck.id !== saved.id) {
    throw new HttpError(422, 'Deck id does not match the saved deck')
  }
  if (hasDataImage(body.deck.slides)) {
    throw new HttpError(422, 'Inline data: images are not allowed')
  }

  const deck: Deck = {
    id: saved.id,
    title: body.deck.title,
    subtitle: body.deck.subtitle ?? '',
    theme: body.deck.theme,
    archetype: body.deck.archetype,
    slides: body.deck.slides as unknown as Slide[],
    settings: body.deck.settings as unknown as DeckSettings,
    createdAt: body.deck.createdAt ?? Date.now(),
    updatedAt: body.deck.updatedAt ?? Date.now(),
  }

  await resolveImages(deck, userId)

  const buffer = await exportPptxBuffer(deck)
  const exportId = randomUUID()
  const objectKey = `x/${userId}/${exportId}.pptx`

  await putObject(
    objectKey,
    new Uint8Array(buffer),
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )

  const meta = {
    engine: 'pptxgenjs',
    native: true,
    filename: `${slug(deck.title)}.pptx`,
    slides: deck.slides.length,
    charts: deck.slides.filter((slide) => slide.chart).length,
    tables: deck.slides.filter((slide) => slide.table).length,
    notes: deck.slides.filter((slide) => slide.notes).length,
  }

  const [row] = await db()
    .insert(deckExports)
    .values({
      id: exportId,
      deckId: saved.id,
      ownerId: userId,
      objectKey,
      format: 'pptx',
      byteSize: buffer.length,
      meta,
    })
    .returning()

  return c.json({
    exportId: row.id,
    downloadUrl: `/api/exports/${row.id}`,
    bytes: row.byteSize,
    meta,
  })
})

routes.get('/:id', requireUser, async (c) => {
  const userId = c.get('userId')
  const [row] = await db()
    .select()
    .from(deckExports)
    .where(and(eq(deckExports.id, c.req.param('id')!), eq(deckExports.ownerId, userId)))
    .limit(1)

  if (!row) throw new HttpError(404, 'Export not found')

  const filename = typeof row.meta.filename === 'string' ? row.meta.filename : 'cadence-deck.pptx'
  const url = await presignGet(row.objectKey, { downloadName: filename })
  c.header('Cache-Control', 'private, max-age=60')
  return c.redirect(url, 302)
})

async function resolveImages(deck: Deck, userId: string): Promise<void> {
  for (const slide of deck.slides) {
    const src = slide.image?.src
    if (!src) continue

    const assetMatch = src.match(/^\/api\/assets\/([0-9a-f-]{36})$/i)
    if (assetMatch) {
      const [asset] = await db()
        .select()
        .from(assets)
        .where(eq(assets.id, assetMatch[1]))
        .limit(1)

      if (!asset || asset.status !== 'ready') {
        throw new HttpError(422, 'A slide references an image that is not ready')
      }
      if (asset.ownerId !== userId) {
        throw new HttpError(403, 'A slide references an image owned by another account')
      }

      slide.image!.src = await presignGet(asset.objectKey)
      continue
    }

    if (src.startsWith('/')) {
      slide.image!.src = `${appOrigin()}${src}`
    }
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'cadence-deck'
  )
}

export default routes
