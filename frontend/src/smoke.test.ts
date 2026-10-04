import { describe, it, expect } from 'vitest';

describe('Frontend Scaffold Smoke Test', () => {
  it('runs in a DOM environment', () => {
    // If happy-dom is not configured, document will be undefined and this test will fail.
    expect(typeof document).toBe('object');
  });
});
