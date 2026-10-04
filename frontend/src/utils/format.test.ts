import { describe, expect, it } from 'vitest';
import {
  buildGoogleMapUrl,
  buildGoogleSearchUrl,
  currentYearMonth,
  defaultForm,
  findLabel,
  formatDateRange,
  formatPrice,
  toMonthParam,
} from './format';
import type { Country } from '../types';

const tw: Country = {
  code: 'tw',
  name: { zh: '台灣', en: 'Taiwan' },
  locations: [
    { value: '臺北', zh: '臺北', en: 'Taipei' },
    { value: '高雄', zh: '高雄', en: 'Kaohsiung' },
  ],
  categories: [
    { value: '6', zh: '展覽', en: 'Exhibition' },
    { value: 1, zh: '音樂', en: 'Music' },
  ],
};

describe('formatDateRange', () => {
  it('shows start only when there is no end time', () => {
    expect(formatDateRange('2026/07/12 19:30:00', null)).toBe('2026/07/12 19:30');
  });

  it('shows a time range on the same day', () => {
    expect(formatDateRange('2026/07/22 19:30:00', '2026/07/22 21:30:00')).toBe('07/22 19:30–21:30');
  });

  it('drops the year inside one month', () => {
    expect(formatDateRange('2026/07/12 19:30:00', '2026/07/14 21:00:00')).toBe('07/12 19:30 – 07/14');
  });

  it('shows full dates across months', () => {
    expect(formatDateRange('2026/01/01 09:00:00', '2026/12/31 18:00:00')).toBe('2026/01/01 – 2026/12/31');
  });
});

describe('formatPrice', () => {
  it('only treats "0" as free', () => {
    expect(formatPrice('0', 'zh')).toBe('免費');
    expect(formatPrice('0', 'en')).toBe('Free');
    expect(formatPrice('', 'zh')).toBe('—');
  });

  it('prefixes $ only for pure numbers', () => {
    expect(formatPrice('800', 'zh')).toBe('$800');
    expect(formatPrice('洽詢主辦單位', 'zh')).toBe('洽詢主辦單位');
    expect(formatPrice('全票100元', 'zh')).toBe('全票100元');
  });
});

describe('external links', () => {
  it('encodes & and # so the link does not break', () => {
    expect(buildGoogleMapUrl('臺北市#1 & 2號', '')).toBe(
      'https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8C%97%E5%B8%82%231%20%26%202%E8%99%9F'
    );
    expect(buildGoogleSearchUrl('A&B')).toBe('https://www.google.com/search?q=A%26B');
  });

  it('falls back to the venue name when the address is empty', () => {
    expect(buildGoogleMapUrl('', '國家音樂廳')).toContain(encodeURIComponent('國家音樂廳'));
  });
});

describe('search form helpers', () => {
  it('uses local time, not UTC, for the default month', () => {
    // Taiwan time 7/1 00:30 becomes 6/30 with toISOString(), which is a subtle bug on the 1st of every month.
    expect(currentYearMonth(new Date(2026, 6, 1, 0, 30))).toEqual({ year: '2026', month: '07' });
  });

  it('builds the API month param', () => {
    expect(toMonthParam('2026', '07')).toBe('2026-07');
  });

  it('resets location and category to the first options of the country', () => {
    expect(defaultForm(tw, new Date(2026, 8, 15))).toEqual({
      country: 'tw',
      location: '臺北',
      category: '6',
      year: '2026',
      month: '09',
    });
  });

  it('finds labels even when the value type differs', () => {
    expect(findLabel(tw.categories, '1')).toEqual({ value: 1, zh: '音樂', en: 'Music' });
    expect(findLabel(tw.categories, '999')).toBeUndefined();
  });
});
