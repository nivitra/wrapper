import { Clerk } from '@clerk/clerk-js'
import type { ClerkUIConstructor } from '@clerk/shared/types'

let instance: Clerk | null = null
let pending: Promise<Clerk> | null = null

export const clerkAppearance = {
  variables: {
    colorPrimary: '#8f86ff',
    colorBackground: '#0e1013',
    colorText: '#e8eaee',
    colorTextSecondary: '#8b919b',
    colorInputBackground: '#13161b',
    colorInputText: '#e8eaee',
    borderRadius: '8px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: {
      width: '100%',
      boxShadow: 'none',
      border: '1px solid #1d2127',
      background: '#0e1013',
    },
    card: { background: 'transparent', boxShadow: 'none' },
    headerTitle: { fontSize: '17px', fontWeight: '600' },
    headerSubtitle: { color: '#8b919b' },
    socialButtonsBlockButton: {
      background: '#13161b',
      borderColor: '#1d2127',
      color: '#e8eaee',
    },
    formFieldInput: { background: '#13161b', borderColor: '#1d2127', color: '#e8eaee' },
    footerActionLink: { color: '#bdb8ff' },
  },
} as const

export function initClerk(): Promise<Clerk> {
  if (instance) return Promise.resolve(instance)
  if (pending) return pending

  pending = (async () => {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
    if (!publishableKey) {
      return null as unknown as Clerkt
    }

    const clerkDomain = atob(publishableKey.split('_')[2]).slice(0, -1)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load the Clerk UI bundle'))
      document.head.appendChild(script)
    })

    const clerk = new Clerk(publishableKey)
    await clerk.load({
      ui: {
        ClerkUI: (window as Window & { __internal_ClerkUICtor?: ClerkUIConstructor })
          .__internal_ClerkUICtor,
      },
    })
    instance = clerk
    return clerk
  })()

  return pending
}

export function clerk(): Clerk {
  if (!instance) throw new Error('Clerk has not finished initialising')
  return instance
}

export function isSignedIn(): boolean {
  return Boolean(instance?.user)
}
export function isAuthConfigured(): boolean {
    return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
}


export function currentUser() {
  return instance?.user ?? null
}

export async function getToken(): Promise<string | null> {
  return (await instance?.session?.getToken()) ?? null
}

export function mountUserButton(el: HTMLElement) {
    if (!instance) return 
  clerk().mountUserButton(el as HTMLDivElement, {
    appearance: {
      variables: { colorPrimary: '#8f86ff' },
      elements: {
        userButtonAvatarBox: { width: '26px', height: '26px' },
        userButtonTrigger: { borderRadius: '99px' },
      },
    },
  })
}

interface AuthPageOptions {
  redirectUrl?: string
  source?: 'app' | 'share'
  shareToken?: string
}

export function mountAuthPage(
  root: HTMLElement,
  mode: 'sign-in' | 'sign-up',
  opts: AuthPageOptions = {}
) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-inner">
        <div class="auth-brand">
          <span class="glyph">C</span>
          <span class="auth-name">Cadence</span>
        </div>
        <p class="auth-lede">${
          mode === 'sign-in'
            ? 'Sign in to compose, edit, and export presentations.'
            : 'Create an account to compose, edit, and export presentations.'
        }</p>
        <div class="auth-card" id="clerk-auth"></div>
        <p class="auth-foot">Your decks stay in your account.</p>
      </div>
    </div>`

  const target = document.getElementById('clerk-auth') as HTMLDivElement
  const redirect = opts.redirectUrl || '/'

  if (mode === 'sign-in') {
    clerk().mountSignIn(target, {
      appearance: clerkAppearance,
      fallbackRedirectUrl: redirect,
      signUpUrl: '/sign-up',
    })
  } else {
    clerk().mountSignUp(target, {
      appearance: clerkAppearance,
      fallbackRedirectUrl: redirect,
      signInUrl: '/sign-in',
      unsafeMetadata:
        opts.source === 'share'
          ? { source: 'share', shareToken: opts.shareToken }
          : { source: 'app' },
    })
  }
}
