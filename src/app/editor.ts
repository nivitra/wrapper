import { demoDeck } from '../model/slides'
  import { store } from '../store'
import type { Deck } from '../model/types'
import { buildShell, renderAll, renderSelection, syncLayout } from '../ui/shell'
import { renderCanvas, refreshScale } from '../ui/canvas'
import { renderRail, slideMenu } from '../ui/rail'
import { renderInspector, refreshInspectorIfIdle } from '../ui/inspector'
import { renderTopbar } from '../ui/topbar'
import { openPalette, closePalette } from '../ui/command'
import { openGenerator } from '../ui/generator'
import { openPresenter, isPresenting, exit } from '../ui/presenter'
import { toggleSorter, closeSorter } from '../ui/sorter'
import { openSettings } from '../ui/settings'
import { popover, toast } from '../ui/dom'
import { api, ApiError } from './api'
import { isAuthConfigured, mountUserButton } from './auth'
import { navigate } from './router'

interface ServerDeck extends Omit<Deck, 'createdAt' | 'updatedAt'> {
  createdAt: string
  updatedAt: string
  revision: number
}

export async function renderEditor(id: string) {
  const app = document.getElementById('app')
  if (!app) throw new Error('Missing #app')

  app.innerHTML = `<div class="app-loading"><span class="spin"></span> Loading deck…</div>`

  let server: ServerDeck
  try {
    const result = await api<{ deck: ServerDeck }>(`/decks/${id}`)
    server = result.deck
  } catch (err) {
    renderEditorError(app, err)
    return
  }

  const deck: Deck = {
    ...server,
    createdAt: Date.parse(server.createdAt),
    updatedAt: Date.parse(server.updatedAt),
  }

  store.setDeck(deck, { snapshot: false })
  store.resetHistory()
  buildShell()

  const topbar = document.querySelector('.topbar')
  if (topbar) mountUserButton(topbar as HTMLElement)

  wireEditor(id, server.revision)
}

function wireEditor(deckId: string, initialRevision: number) {
  let revision = initialRevision
  let saveTimer: number | undefined
  let saving = false
  let queued = false
  let inlineTimer: number | undefined

  /* deep links: #slide=3&theme=aurora */
  {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''))
    const themeId = params.get('theme')
    const slideNo = params.get('slide')
    if (themeId) {
      store.deck.theme = themeId
      store.deck.settings.accent = null
    }
    if (slideNo !== null) {
      const idx = Math.max(0, Math.min(store.deck.slides.length - 1, Number(slideNo) - 1))
      store.ui.selectedId = store.deck.slides[idx]?.id ?? null
    }
    if (themeId || slideNo !== null) renderAll()
  }

  async function save() {
    if (saving) {
      queued = true
      return
    }
    saving = true
    const deck = store.deck
    try {
      const result = await api<{ deck: { revision: number } }>(`/decks/${deckId}`, {
        method: 'PUT',
        headers: { 'if-match': String(revision) },
        body: JSON.stringify({
          title: deck.title,
          subtitle: deck.subtitle,
          theme: deck.theme,
          archetype: deck.archetype,
          settings: deck.settings,
          slides: deck.slides,
        }),
      })
      revision = result.deck.revision
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast('This deck changed in another tab. Reload before saving.', 'err')
      } else {
        toast(err instanceof Error ? err.message : 'Save failed', 'err')
      }
    } finally {
      saving = false
      if (queued) {
        queued = false
        void save()
      }
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void save(), 1500)
  }

  store.subscribe((kind) => {
    switch (kind) {
      case 'deck':
      case 'theme':
        renderAll()
        scheduleSave()
        break
      case 'selection':
        renderSelection()
        break
      case 'ui':
        syncLayout()
        renderTopbar()
        renderInspector()
        refreshScale()
        break
      case 'generate':
        renderCanvas()
        break
      case 'settings':
        renderCanvas()
        renderRail()
        renderTopbar()
        refreshScale()
        scheduleSave()
        break
      case 'inline':
        window.clearTimeout(inlineTimer)
        inlineTimer = window.setTimeout(() => {
          renderRail()
          refreshInspectorIfIdle()
          renderTopbar()
          renderCanvas()
        }, 240)
        scheduleSave()
        break
    }
  })

  function isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null
    if (!t) return false
    return (
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable
    )
  }

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      openPalette()
      return
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      openGenerator()
      return
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void import('../ui/exports').then((m) => m.runExport('project'))
      return
    }
    if (mod && e.key.toLowerCase() === 'z') {
      if (isTyping(e)) return
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'd') {
      if (isTyping(e)) return
      e.preventDefault()
      if (store.slide) store.duplicateSlide(store.slide.id)
      return
    }
    if (mod && (e.key === '1' || e.key === '2')) {
      e.preventDefault()
      if (e.key === '1') store.ui.railOpen = !store.ui.railOpen
      else store.ui.inspectorOpen = !store.ui.inspectorOpen
      store.emit('ui')
      return
    }

    if (isTyping(e) || store.ui.presenting) return

    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault()
      openPresenter()
    }
    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault()
      toggleSorter()
    }
    if (e.key === 'n' || e.key === 'N') {
      store.ui.tab = 'notes'
      store.emit('ui')
      ;(document.querySelector('.insp-body textarea') as HTMLTextAreaElement | null)?.focus()
    }
    if (e.key === 'Escape') {
      closePalette()
      closeSorter()
      if (isPresenting()) exit()
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.deck.slides.length > 1 && store.slide) {
        e.preventDefault()
        store.removeSlide(store.slide.id)
      }
    }
  })

  window.addEventListener('cadence:sorter', () => toggleSorter())
  window.addEventListener('cadence:settings', () => openSettings())
  window.addEventListener('cadence:ai-changed', () => renderTopbar())
  window.addEventListener('cadence:add', () => {
    const anchor = document.querySelector('.rail-foot [data-add]') as HTMLElement | null
    if (anchor) popover(anchor, slideMenu())
  })

  window.addEventListener('pagehide', () => {
    store.persistNow()
    void save()
  })
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.persistNow()
  })

  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  ;(window as unknown as { cadence: unknown }).cadence = {
    store,
    renderAll,
    openPresenter,
    toggleSorter,
    openGenerator,
    save,
  }
}

function renderEditorError(app: HTMLElement, err: unknown) {
  const status = err instanceof ApiError ? err.status : 0
  const message =
    status === 403
      ? 'This account does not have access to edit decks.'
      : status === 404
        ? 'That deck could not be found.'
        : err instanceof Error
          ? err.message
          : 'Could not load this deck.'

  app.innerHTML = `
    <div class="app-error">
      <div class="auth-brand"><span class="glyph">C</span><span class="auth-name">Cadence</span></div>
      <h2>${status === 404 ? 'Deck not found' : 'Could not open this deck'}</h2>
      <p>${escape(message)}</p>
      <button class="btn" data-home>Back to your decks</button>
    </div>`
  app.querySelector('[data-home]')?.addEventListener('click', () => navigate('/'))
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )
}
