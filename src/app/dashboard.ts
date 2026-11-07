import type { DeckSettings, Slide } from '../model/types'
  import { demoDeck } from '../model/slides'
import { getTheme } from '../design/themes'
import { toast } from '../ui/dom'
import { api, ApiError } from './api'
import { currentUser, mountUserButton } from './auth'
import { navigate } from './router'

interface DeckSummary {
  id: string
  title: string
  subtitle: string
  theme: string
  slideCount: number | null
  revision: number
  updatedAt: string
}

interface MeResponse {
  role: 'creator' | 'viewer'
  user: { name: string | null; email: string }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export async function renderDashboard() {
  const app = document.getElementById('app')
  if (!app) throw new Error('Missing #app')

  app.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <div class="brandmark">
          <span class="glyph">C</span>
          <span class="name">Cadence</span>
        </div>
        <div class="spacer"></div>
        <div class="dash-user" id="dash-user"></div>
      </header>
      <main class="dash-main">
        <div class="dash-bar">
          <div>
            <h1>Your decks</h1>
            <p class="dash-sub">Compose, edit, and export presentation decks.</p>
          </div>
          <button class="btn primary" data-new>New deck</button>
        </div>
        <div class="dash-body" id="dash-body">
          <div class="dash-empty">Loading…</div>
        </div>
      </main>
    </div>`

  const userSlot = document.getElementById('dash-user')
  if (userSlot) mountUserButton(userSlot)

  const newBtn = app.querySelector('[data-new]') as HTMLButtonElement

  let me: MeResponse
  try {
    me = await api<MeResponse>('/me')
  } catch (err) {
    renderError(app, err)
    return
  }

  if (me.role !== 'creator') {
    newBtn.classList.add('hide')
    renderUpgrade(app)
    return
  }

  newBtn.addEventListener('click', () => void createDeck(newBtn))

  try {
    const { decks } = await api<{ decks: DeckSummary[] }>('/decks')
    renderList(app, decks)
  } catch (err) {
    renderError(app, err)
  }
}

function renderList(app: HTMLElement, decks: DeckSummary[]) {
  const body = app.querySelector('#dash-body') as HTMLElement
  if (!decks.length) {
    body.innerHTML = `
      <div class="dash-empty">
        <h2>No decks yet</h2>
        <p>Start with a composed draft, then shape it in the editor.</p>
        <button class="btn primary" data-empty-new>Create your first deck</button>
      </div>`
    body
      .querySelector('[data-empty-new]')
      ?.addEventListener('click', () => void createDeck())
    return
  }

  body.innerHTML = `<div class="deck-grid">${decks
    .map((deck) => {
      const theme = getTheme(deck.theme)
      return `<button class="deck-card" data-id="${deck.id}">
        <span class="deck-swatch" style="background:${theme.color.accent}"></span>
        <span class="deck-title">${escape(deck.title || 'Untitled deck')}</span>
        <span class="deck-meta">${deck.slideCount ?? 0} slides · ${escape(theme.name)} · ${fmtDate(
        deck.updatedAt
      )}</span>
      </button>`
    })
    .join('')}</div>`

  body.querySelectorAll<HTMLElement>('.deck-card').forEach((card) => {
    card.addEventListener('click', () => navigate(`/d/${card.dataset.id}`))
  })
}

function renderUpgrade(app: HTMLElement) {
  const body = app.querySelector('#dash-body') as HTMLElement
  const name = currentUser()?.firstName || currentUser()?.primaryEmailAddress?.emailAddress || 'You'
  body.innerHTML = `
    <div class="dash-empty">
      <h2>${escape(name)} has viewer access</h2>
      <p>Viewers can open decks shared with them. Upgrade to create, edit, and export your own.</p>
      <button class="btn primary" data-upgrade>Upgrade to creator</button>
    </div>`
  body.querySelector('[data-upgrade]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'Upgrading…'
    try {
      await api('/me/upgrade', { method: 'POST' })
      toast('Creator access enabled')
      await renderDashboard()
    } catch (err) {
      btn.disabled = false
      btn.textContent = 'Upgrade to creator'
      toast(err instanceof Error ? err.message : 'Upgrade failed', 'err')
    }
  })
}

async function createDeck(button?: HTMLButtonElement) {
  if (button) {
    button.disabled = true
    button.textContent = 'Creating…'
  }
  const demo = demoDeck('obsidian')
  try {
    const { deck } = await api<{ deck: { id: string } }>('/decks', {
      method: 'POST',
      body: JSON.stringify({
        title: demo.title,
        subtitle: demo.subtitle,
        theme: demo.theme,
        archetype: demo.archetype,
        settings: demo.settings as DeckSettings,
        slides: demo.slides as Slide[],
      }),
    })
    navigate(`/d/${deck.id}`)
  } catch (err) {
    if (button) {
      button.disabled = false
      button.textContent = 'New deck'
    }
    toast(err instanceof Error ? err.message : 'Could not create a deck', 'err')
  }
}

function renderError(app: HTMLElement, err: unknown) {
  const body = app.querySelector('#dash-body') as HTMLElement
  const message =
    err instanceof ApiError
      ? err.status === 403
        ? 'Your account needs creator access to list decks.'
        : err.message
      : err instanceof Error
        ? err.message
        : 'Something went wrong'
  body.innerHTML = `<div class="dash-empty"><h2>Could not load your decks</h2><p>${escape(
    message
  )}</p><button class="btn" data-retry>Retry</button></div>`
  body.querySelector('[data-retry]')?.addEventListener('click', () => void renderDashboard())
}

export type { DeckSummary }
