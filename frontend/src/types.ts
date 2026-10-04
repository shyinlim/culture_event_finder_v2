// Mirrors backend /api/v1 contracts 1:1.

export interface EventShow {
  startTime: string; // "2026/07/12 19:30:00"
  endTime: string | null;
}

export interface EventItem {
  id: string;
  title: string;
  startTime: string; // "2026/07/12 19:30:00"
  endTime: string | null;
  location: string; // Address
  locationName: string; // Venue name
  onSales: boolean;
  price: string; // Free text: "500", "0", or inquiry text
  shows: EventShow[];
}

export interface LabeledOption {
  value: string | number; // Always compare using String() to tolerate number/string types from backend
  zh: string;
  en: string;
}

export interface Country {
  code: string;
  name: { zh: string; en: string };
  locations: LabeledOption[];
  categories: LabeledOption[];
}

export interface QueryMeta {
  rawCount: number;
  matchedCount: number;
  cacheAge: number | null; // null indicates cache miss
}

export interface SearchForm {
  country: string;
  location: string;
  category: string;
  year: string; // "2026"
  month: string; // "07"
}
