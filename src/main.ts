import './styles/app.css'
import './styles/slide.css'

import { initClerk, isAuthConfigured, isSignedIn, mountAuthPage } from './app/auth'
import { renderDashboard } from './app/dashboard'
import { renderEditor } from './app/editor'
import { navigate, parseRoute, redirectUrl, startRouter } from './app/router'

const app = document.getElementById('app')
if (!app) throw new Error('Missing #app')

await initClerk()

startRouter((route) => {
if (!isAuthConfigured()) {
void renderEditor('local')
return
}
  if (!isSignedIn()) {
    if (route.name === 'sign-in' || route.name === 'sign-up') {
      mountAuthPage(app, route.name, { redirectUrl: redirectUrl() })
      return
    }

    const here = location.pathname + location.search
    navigate(`/sign-in?redirect_url=${encodeURIComponent(here)}`, { replace: true })
    return
  }

  switch (route.name) {
    case 'sign-in':
    case 'sign-up':
      navigate(redirectUrl(), { replace: true })
      break
    case 'editor':
      void renderEditor(route.id)
      break
    case 'share':
      location.replace(`/s/${route.token}`)
      break
    case 'not-found':
      app.innerHTML = `
        <div class="app-error">
          <div class="auth-brand"><span class="glyph">C</span><span class="auth-name">Cadence</span></div>
          <h2>Page not found</h2>
          <p>The page you are looking for does not exist.</p>
          <button class="btn" data-home>Back to your decks</button>
        </div>`
      app.querySelector('[data-home]')?.addEventListener('click', () => navigate('/'))
      break
    default:
      void renderDashboard()
  }
})

window.addEventListener('cadence:route', () => {
  const route = parseRoute()
  if (route.name === 'dashboard') void renderDashboard()
})
