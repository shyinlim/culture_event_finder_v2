import type { Country, LabeledOption, SearchForm } from '../types';

// MoC time format is 'YYYY/MM/DD HH:MM:SS': first 10 characters are date, next 5 are HH:MM.
function splitTime(moc: string): { day: string; hm: string } {
  const [day, time = ''] = moc.split(' ');
  return { day, hm: time.slice(0, 5) };
}

export function formatDateRange(start: string, end: string | null): string {
  const s = splitTime(start);
  if (!end) return `${s.day} ${s.hm}`.trim();
  const e = splitTime(end);
  // Same day shows time range, e.g., 07/22 19:30–21:30.
  if (s.day === e.day) return `${s.day.slice(5)} ${s.hm}–${e.hm}`;
  // Same month shows start time to end day, e.g., 07/12 19:30 – 07/14.
  if (s.day.slice(0, 7) === e.day.slice(0, 7)) return `${s.day.slice(5)} ${s.hm} – ${e.day.slice(5)}`;
  // Across months shows full dates, e.g., 2026/01/01 – 2026/12/31.
  return `${s.day} – ${e.day}`;
}

// Price is free text: only '0' is treated as free, pure numbers get a $, other text remains as-is.
export function formatPrice(price: string, lang: 'zh' | 'en'): string {
  const text = price.trim();
  if (text === '') return '—';
  if (text === '0') return lang === 'en' ? 'Free' : '免費';
  if (/^\d+$/.test(text)) return `$${text}`;
  return text;
}

export function buildGoogleMapUrl(location: string, locationName: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location || locationName)}`;
}

export function buildGoogleSearchUrl(title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(title)}`;
}

// Always use local time; toISOString() is UTC, which shifts Taiwan time backwards on the 1st of each month.
export function currentYearMonth(now: Date): { year: string; month: string } {
  return { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0') };
}

export function toMonthParam(year: string, month: string): string {
  return `${year}-${month}`;
}

// Shared by default form, country switch, and form reset.
export function defaultForm(country: Country, now: Date): SearchForm {
  return {
    country: country.code,
    location: String(country.locations[0].value),
    category: String(country.categories[0].value),
    ...currentYearMonth(now),
  };
}

export function findLabel(options: LabeledOption[], value: string): LabeledOption | undefined {
  return options.find((o) => String(o.value) === String(value));
}
