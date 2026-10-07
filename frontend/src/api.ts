import type { Country, EventItem, QueryMeta, SearchForm } from './types';
import { toMonthParam } from './utils/format';

// Three error categories drive the UI: transient (retryable), upstream (MoC down), client (invalid params).
export class TransientError extends Error {
  name = 'TransientError';
}
export class UpstreamError extends Error {
  name = 'UpstreamError';
}
export class ClientError extends Error {
  name = 'ClientError';
}

export type ErrorKind = 'transient' | 'upstream' | 'client';

export function errorKind(err: unknown): ErrorKind {
  if (err instanceof UpstreamError) return 'upstream';
  if (err instanceof ClientError) return 'client';
  return 'transient';
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: {
        'X-Request-ID': crypto.randomUUID(),
      },
    });
  } catch (err) {
    // AbortError indicates cancelled request due to a newer search; rethrow as-is.
    if ((err as Error).name === 'AbortError') throw err;
    throw new TransientError('network error');
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. Render waking up or proxy errors); treat as transient, not upstream.
    throw new TransientError(`non-JSON response (${res.status})`);
  }

  if (res.ok) return body as T;
  if (res.status === 502 && body?.error?.code === 'upstream_error') throw new UpstreamError(body.error.message);
  if (res.status === 400 || res.status === 404) throw new ClientError(body?.error?.message ?? String(res.status));
  throw new TransientError(`HTTP ${res.status}`);
}

export function fetchCountries(signal?: AbortSignal): Promise<Country[]> {
  return getJson<Country[]>('/api/v2/countries', signal);
}

export function searchEvents(
  form: SearchForm,
  signal?: AbortSignal,
): Promise<{ events: EventItem[]; meta: QueryMeta }> {
  const params = new URLSearchParams({
    category: form.category,
    location: form.location,
    month: toMonthParam(form.year, form.month),
  });
  return getJson(`/api/v2/${form.country}/events?${params}`, signal);
}
