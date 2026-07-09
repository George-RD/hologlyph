/**
 * Tiny typed event emitter plus a lifecycle-guarded utterance handle used by
 * the speech adapters and the speech engine. The handle enforces the contract
 * ordering: `start` fires before the first `viseme`/`energy`, and exactly one
 * terminal `end` is emitted (including after a cancel or an error).
 */

import type {
  Emitter,
  Listener,
  UtteranceEvents,
  UtteranceHandle,
  VisemeFrame,
} from '../contracts';

type AnyListener = Listener<unknown>;

export class EmitterImpl<Events extends Record<string, unknown>> implements Emitter<Events> {
  private readonly _listeners = new Map<keyof Events, Set<AnyListener>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set<AnyListener>();
      this._listeners.set(event, set);
    }
    set.add(fn as AnyListener);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(fn as AnyListener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      (fn as Listener<Events[K]>)(payload);
    }
  }

  protected clearListeners(): void {
    this._listeners.clear();
  }
}

export class UtteranceHandleImpl extends EmitterImpl<UtteranceEvents> implements UtteranceHandle {
  private _cancelled = false;
  private _started = false;
  private _ended = false;
  private _cancelFn: (() => void) | null = null;

  setCancel(fn: () => void): void {
    this._cancelFn = fn;
  }

  cancel(): void {
    if (this._ended) return;
    this._cancelled = true;
    this._cancelFn?.();
    this.finish();
  }

  begin(): void {
    if (this._started || this._ended) return;
    this._started = true;
    this.emit('start', undefined);
  }

  viseme(frame: VisemeFrame): void {
    if (!this._started || this._ended) return;
    this.emit('viseme', frame);
  }

  energy(value: number): void {
    if (!this._started || this._ended) return;
    this.emit('energy', value);
  }

  stall(): void {
    if (!this._started || this._ended) return;
    this.emit('stall', undefined);
  }

  fail(error: Error): void {
    if (this._ended) return;
    this.emit('error', error);
    this.finish();
  }

  finish(): void {
    if (this._ended) return;
    this._ended = true;
    this.emit('end', undefined);
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  get started(): boolean {
    return this._started;
  }

  get ended(): boolean {
    return this._ended;
  }
}
