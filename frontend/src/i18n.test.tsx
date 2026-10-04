import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { I18nProvider, pickLabel, translate, useI18n } from './i18n';

// Let React know this is a test environment so act() waits for effects.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('i18n', () => {
  it('falls back to the key itself when a key is missing', () => {
    expect(translate('en', 'no_such_key')).toBe('no_such_key');
  });

  it('fills {{params}}', () => {
    expect(translate('zh', 'result_count', { place: '臺北', category: '音樂', ym: '2026/07', count: 12 }))
      .toBe('臺北 · 音樂 · 2026/07 共 12 筆');
  });

  it('pickLabel returns English in en', () => {
    expect(pickLabel({ zh: '台灣', en: 'Taiwan' }, 'en')).toBe('Taiwan');
  });

  it('switching language updates <html lang> and remembers it', async () => {
    const ref: { current: ReturnType<typeof useI18n> | null } = { current: null };
    function Probe() {
      ref.current = useI18n();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<I18nProvider><Probe /></I18nProvider>));

    await act(async () => ref.current!.setLang('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');

    await act(async () => ref.current!.setLang('zh'));
    expect(document.documentElement.lang).toBe('zh-Hant');
    await act(async () => root.unmount());
  });
});
