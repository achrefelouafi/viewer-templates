import {
  type AuthData,
  Auth,
  callService,
  type Connection,
  createConnection,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  genExpires,
  getAuth,
  subscribeEntities,
} from 'home-assistant-js-websocket'
import { create } from 'zustand'
import type { HassEntities } from '../entities'
import { takeHassCallback } from './callback'

/* The viewer's connection to the visitor's own Home Assistant: its sign-in (Home Assistant's own
   login page, which hands back a key), the live states of every entity, and the area each one is
   in. The key stays in this tab's sessionStorage, as the Pascal credentials do; the address is
   remembered (it is not a secret) so the next visit only asks to sign in again. */

const URL_KEY = 'pascal-ha-url'
const TOKENS_KEY = 'pascal-ha-auth'
/** The address a sign-in was started for: a sign-in coming back for any other is refused. */
const PENDING_KEY = 'pascal-ha-pending'

export type HassStatus = 'idle' | 'redirecting' | 'connecting' | 'connected' | 'error'

type HassState = {
  status: HassStatus
  /** The address last used, to fill in the form. */
  hassUrl: string
  /** What went wrong, in words a visitor can act on. */
  error: string | null
  entities: HassEntities
  /** Each entity's area name, from Home Assistant's registries (its own, else its device's). */
  areaOf: Record<string, string>
  connection: Connection | null
  /** Picks up a sign-in that just came back, or this tab's key; does nothing without either. */
  resume: () => Promise<void>
  /** Sends the visitor to their Home Assistant's login page. */
  signIn: (address: string) => Promise<void>
  disconnect: () => void
  call: (domain: string, service: string, data: Record<string, unknown>) => void
}

/** "myhome.duckdns.org:8123/" → "https://myhome.duckdns.org:8123". */
export function normalizeAddress(address: string): string {
  let a = address.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(a)) a = `${location.protocol === 'https:' ? 'https' : 'http'}://${a}`
  const url = new URL(a)
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

const saveTokens = (data: AuthData | null) => {
  if (data) sessionStorage.setItem(TOKENS_KEY, JSON.stringify(data))
  else sessionStorage.removeItem(TOKENS_KEY)
}
const loadTokens = (): AuthData | null => {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? 'null') as AuthData | null
  } catch {
    return null
  }
}

/** Why a connection failed, said so a visitor knows what to change. */
function explain(failure: unknown, hassUrl: string): string {
  const origin = location.origin
  if (failure === ERR_INVALID_AUTH) return 'Home Assistant refused the sign-in. Connect again to sign in afresh.'
  if (failure === ERR_CANNOT_CONNECT) return `Could not reach ${hassUrl}. Check the address, and that it opens in this browser.`
  if (failure instanceof TypeError) {
    // a fetch the browser blocked or could not make: the address is wrong, or Home Assistant
    // does not allow this site (the browser does not say which)
    return `Could not reach ${hassUrl} from this page. Check it opens in this browser, and that your configuration.yaml has ${origin} under http: cors_allowed_origins (then restart Home Assistant).`
  }
  return failure instanceof Error ? failure.message : 'Connecting to Home Assistant failed.'
}

/** Trades the code a sign-in came back with for a key (Home Assistant's token request). */
async function finishSignIn(code: string, state: string): Promise<AuthData> {
  const decoded = JSON.parse(atob(state)) as { hassUrl: string; clientId: string | null; nonce?: string }
  const pending = sessionStorage.getItem(PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  if (!pending || decoded.hassUrl !== pending) throw new Error('That sign-in was not started here. Connect again.')
  let verifier: string | undefined
  if (decoded.nonce) {
    const key = `hass_oauth_state_${decoded.nonce}`
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { codeVerifier: string; state: string } | null
    sessionStorage.removeItem(key)
    if (stored?.state !== state) throw new Error('That sign-in was not started here. Connect again.')
    verifier = stored.codeVerifier
  }
  const body = new URLSearchParams({ grant_type: 'authorization_code', code })
  if (decoded.clientId) body.set('client_id', decoded.clientId)
  if (verifier) body.set('code_verifier', verifier)
  const res = await fetch(`${decoded.hassUrl}/auth/token`, { method: 'POST', credentials: 'same-origin', body })
  if (!res.ok) throw new Error(`Home Assistant refused the sign-in (${res.status}). Connect again.`)
  const tokens = (await res.json()) as Omit<AuthData, 'hassUrl' | 'clientId' | 'expires'>
  return { ...tokens, hassUrl: decoded.hassUrl, clientId: decoded.clientId, expires: genExpires(tokens.expires_in) }
}

type Registry = {
  areas: { area_id: string; name: string }[]
  devices: { id: string; area_id: string | null }[]
  entities: { entity_id: string; area_id: string | null; device_id: string | null }[]
}

async function readAreas(connection: Connection): Promise<Record<string, string>> {
  const [areas, devices, entities] = await Promise.all([
    connection.sendMessagePromise<Registry['areas']>({ type: 'config/area_registry/list' }),
    connection.sendMessagePromise<Registry['devices']>({ type: 'config/device_registry/list' }),
    connection.sendMessagePromise<Registry['entities']>({ type: 'config/entity_registry/list' }),
  ])
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]))
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]))
  const out: Record<string, string> = {}
  for (const e of entities) {
    const id = e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) : null)
    const name = id ? areaName.get(id) : undefined
    if (name) out[e.entity_id] = name
  }
  return out
}

let resuming: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

export const useHass = create<HassState>((set, get) => {
  const open = async (auth: Auth) => {
    set({ status: 'connecting', error: null, hassUrl: auth.data.hassUrl })
    try {
      const connection = await createConnection({ auth })
      const areaOf = await readAreas(connection)
      unsubscribe?.()
      unsubscribe = subscribeEntities(connection, (entities) => set({ entities: entities as unknown as HassEntities }))
      // rooms change while the plan is open (a device put in an area): read them again, once a burst settles
      let pending = 0
      const reread = () => {
        window.clearTimeout(pending)
        pending = window.setTimeout(() => void readAreas(connection).then((a) => set({ areaOf: a })), 400)
      }
      connection.addEventListener('ready', reread)
      for (const event of ['area_registry_updated', 'device_registry_updated', 'entity_registry_updated']) {
        void connection.subscribeEvents(reread, event)
      }
      set({ status: 'connected', connection, areaOf })
    } catch (failure) {
      if (failure === ERR_INVALID_AUTH) saveTokens(null)
      set({ status: 'error', error: explain(failure, auth.data.hassUrl), connection: null })
    }
  }

  return {
    status: 'idle',
    hassUrl: localStorage.getItem(URL_KEY) ?? '',
    error: null,
    entities: {},
    areaOf: {},
    connection: null,

    resume: () => {
      resuming ??= (async () => {
        const back = takeHassCallback()
        if (back) {
          set({ status: 'connecting', error: null })
          try {
            const data = await finishSignIn(back.code, back.state)
            saveTokens(data)
            await open(new Auth(data, saveTokens))
          } catch (failure) {
            set({ status: 'error', error: explain(failure, sessionStorage.getItem(PENDING_KEY) ?? get().hassUrl) })
          }
          return
        }
        const saved = loadTokens()
        if (saved) await open(new Auth(saved, saveTokens))
      })()
      return resuming
    },

    signIn: async (address) => {
      let hassUrl: string
      try {
        hassUrl = normalizeAddress(address)
      } catch {
        set({ status: 'error', error: 'That is not an address. Try something like https://myhome.duckdns.org' })
        return
      }
      if (location.protocol === 'https:' && hassUrl.startsWith('http:')) {
        set({ status: 'error', error: 'This viewer is on https, so your Home Assistant must be too (a browser will not mix them).' })
        return
      }
      localStorage.setItem(URL_KEY, hassUrl)
      sessionStorage.setItem(PENDING_KEY, hassUrl)
      saveTokens(null)
      set({ status: 'redirecting', error: null, hassUrl })
      // no key stored: the library sends the page to Home Assistant's login, and comes back here
      await getAuth({ hassUrl, loadTokens: async () => null, saveTokens }).catch((failure: unknown) =>
        set({ status: 'error', error: explain(failure, hassUrl) }))
    },

    disconnect: () => {
      unsubscribe?.()
      unsubscribe = null
      get().connection?.close()
      saveTokens(null)
      resuming = null
      set({ status: 'idle', connection: null, entities: {}, areaOf: {}, error: null })
    },

    call: (domain, service, data) => {
      const connection = get().connection
      if (!connection) return
      callService(connection, domain, service, data).catch((failure: unknown) =>
        // Home Assistant answers a failed call with { code, message }, not an Error
        set({ error: (failure as { message?: string } | null)?.message ?? `${domain}.${service} failed` }))
    },
  }
})
