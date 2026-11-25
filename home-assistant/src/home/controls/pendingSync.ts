/* Ported from home-assistant/frontend (Apache-2.0):
   - src/common/util/pending-value-sync.ts
   - src/common/util/debounce.ts */

/**
 * Keeps a locally edited value from being overwritten by entity state updates
 * while a debounced change is waiting to be sent or the service call is in flight.
 */
export class PendingValueSync {
  private _scheduled = false
  private _latestCall?: symbol

  public get pending(): boolean {
    return this._scheduled || this._latestCall !== undefined
  }

  public schedule(): void {
    this._scheduled = true
  }

  public reset(): void {
    this._scheduled = false
    this._latestCall = undefined
  }

  public shouldSync(): boolean {
    return !this.pending
  }

  public async run(
    call: () => Promise<boolean> | void,
    resync: () => void,
  ): Promise<void> {
    const thisCall = Symbol('call')
    this._scheduled = false
    this._latestCall = thisCall
    let failed = false
    try {
      const ok = await call()
      if (ok === false) failed = true
    } catch {
      failed = true
    }
    if (this._latestCall !== thisCall) return
    this._latestCall = undefined
    if (failed && !this._scheduled) resync()
  }
}

export type DebouncedFn<T extends unknown[]> = ((...args: T) => void) & {
  cancel: () => void
}

export function createDebounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
): DebouncedFn<T> {
  let timer: number | undefined
  const debounced = (...args: T) => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      fn(...args)
    }, waitMs)
  }
  debounced.cancel = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }
  return debounced
}
