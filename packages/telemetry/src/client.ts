/**
 * The sidecar's one real job: forward lifecycle events and a heartbeat to the
 * Relay over outbound HTTPS. No inbound port, no custody — it cannot move
 * funds by construction, because nothing here ever holds a key or signs a
 * transaction.
 *
 * `reportStage`/`heartbeat` are fire-and-forget by design, not merely by
 * accident: WP-17's own acceptance gate requires that a forwarded event's
 * HTTP call failing or timing out never blocks or delays the solver's own
 * decision/submission path. Making the interface `void`, not `Promise<void>`,
 * is what makes that a compile-time guarantee rather than a discipline the
 * caller has to remember — nothing here can be `await`-ed into the solver's
 * own critical path even by mistake.
 */

import type { TelemetryHeartbeat, TelemetryStageEvent } from './types.js';

export interface TelemetryClient {
  reportStage(event: TelemetryStageEvent): void;
  heartbeat(beat: TelemetryHeartbeat): void;
}

/** `TELEMETRY_ENABLED=false` — the solver is correct with this, never merely tolerant of it. */
export class NoopTelemetryClient implements TelemetryClient {
  reportStage(_event: TelemetryStageEvent): void {}
  heartbeat(_beat: TelemetryHeartbeat): void {}
}

export interface HttpTelemetryClientOptions {
  readonly relayUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Never rethrown — telemetry failures are observed, not propagated. */
  readonly onError?: (error: unknown, context: 'reportStage' | 'heartbeat') => void;
}

export class HttpTelemetryClient implements TelemetryClient {
  private readonly relayUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onError: HttpTelemetryClientOptions['onError'];

  constructor(options: HttpTelemetryClientOptions) {
    this.relayUrl = options.relayUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onError = options.onError;
  }

  reportStage(event: TelemetryStageEvent): void {
    this.post('/v1/telemetry/events', event, 'reportStage');
  }

  heartbeat(beat: TelemetryHeartbeat): void {
    this.post('/v1/telemetry/heartbeat', beat, 'heartbeat');
  }

  /**
   * Deliberately not `async` and deliberately not returned: a caller that
   * awaited this would put the Relay back on the solver's critical path,
   * exactly what this class exists to prevent. The promise is created and
   * its rejection handled entirely inside this function.
   */
  private post(path: string, body: unknown, context: 'reportStage' | 'heartbeat'): void {
    this.fetchImpl(`${this.relayUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((error: unknown) => this.onError?.(error, context));
  }
}
