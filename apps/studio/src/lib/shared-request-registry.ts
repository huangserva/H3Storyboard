interface SharedRequestEntry<Value> {
  readonly controller: AbortController;
  readonly promise: Promise<Value>;
  consumers: number;
  abort_timer: ReturnType<typeof setTimeout> | null;
}

export interface SharedRequestLease<Value> {
  readonly promise: Promise<Value>;
  release(): void;
}

export class SharedRequestRegistry<Value> {
  readonly #entries = new Map<string, SharedRequestEntry<Value>>();

  acquire(key: string,
    request: (signal: AbortSignal) => Promise<Value>): SharedRequestLease<Value> {
    let entry = this.#entries.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      entry = { controller, promise: request(controller.signal),
        consumers: 0, abort_timer: null };
      this.#entries.set(key, entry);
      const forget = () => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
      };
      void entry.promise.then(forget, forget);
    }
    if (entry.abort_timer !== null) {
      clearTimeout(entry.abort_timer);
      entry.abort_timer = null;
    }
    entry.consumers += 1;
    let released = false;
    return { promise: entry.promise, release: () => {
      if (released) return;
      released = true;
      entry!.consumers -= 1;
      if (entry!.consumers !== 0 || entry!.controller.signal.aborted) return;
      entry!.abort_timer = setTimeout(() => {
        entry!.abort_timer = null;
        if (entry!.consumers === 0) entry!.controller.abort();
      }, 0);
    } };
  }
}
