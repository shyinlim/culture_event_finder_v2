import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientError, TransientError, UpstreamError, fetchCountries, searchEvents } from './api';

function mockFetch(body: string, status: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
}

const form = { country: 'tw', location: '臺北', category: '6', year: '2026', month: '07' };

describe('api error classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on 200', async () => {
    mockFetch('[{"code":"tw"}]', 200);
    await expect(fetchCountries()).resolves.toEqual([{ code: 'tw' }]);
  });

  it('builds the events URL with encoded params and sends X-Request-ID header', async () => {
    mockFetch('{"events":[],"meta":{}}', 200);
    await searchEvents(form);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      '/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=2026-07'
    );
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toHaveProperty('X-Request-ID');
  });

  it('treats an HTML page (Render waking up) as transient, never as a MoC failure', async () => {
    mockFetch('<html>waking up</html>', 200);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
    mockFetch('<html>bad gateway</html>', 502);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('treats 503 as transient', async () => {
    mockFetch('{"error":{"code":"x","message":"y"}}', 503);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('only a 502 with upstream_error JSON is an upstream error', async () => {
    mockFetch('{"error":{"code":"upstream_error","message":"MoC down"}}', 502);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('400 and 404 are client errors', async () => {
    mockFetch('{"error":{"code":"bad_request","message":"bad"}}', 400);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(ClientError);
    mockFetch('{"error":{"code":"not_found","message":"nope"}}', 404);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(ClientError);
  });

  it('network failure is transient', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('lets AbortError through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(fetchCountries()).rejects.toHaveProperty('name', 'AbortError');
  });
});
