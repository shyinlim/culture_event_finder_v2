import type { Country } from '../types';
import { useI18n } from '../i18n';

// Countries without an active provider are visually de-emphasized.
const COMING_SOON = [
  { code: 'JP', name: { zh: '日本', en: 'Japan' } },
  { code: 'KR', name: { zh: '韓國', en: 'Korea' } },
];

export function CountryPicker({ countries, active, onPick }: {
  countries: Country[];
  active: string;
  onPick: (code: string) => void;
}) {
  const { label, t } = useI18n();
  return (
    <div className="flex items-center gap-2 self-start md:self-auto bg-[var(--surface-2)] p-1.5 rounded-full border border-[var(--panel-border-dim)] shadow-sm">
      {countries.map((c) => (
        <button
          key={c.code}
          type="button"
          aria-pressed={c.code === active}
          onClick={() => onPick(c.code)}
          className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-sm rounded-full ${c.code === active ? 'btn-primary shadow' : 'btn-secondary'}`}
        >
          <span className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">{c.code.toUpperCase()}</span>
          {label(c.name)}
        </button>
      ))}
      {COMING_SOON.map((c) => (
        // Use aria-disabled rather than disabled so screen readers and keyboards can still reach it.
        <button
          key={c.code}
          type="button"
          aria-disabled="true"
          title={t('coming_soon')}
          aria-label={`${label(c.name)} (${t('coming_soon')})`}
          onClick={(e) => e.preventDefault()}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-sm text-[var(--text-muted)] cursor-not-allowed opacity-60"
        >
          <span className="h-5 w-5 rounded-full bg-[var(--panel-border-dim)] flex items-center justify-center text-[10px] font-bold">{c.code}</span>
          {label(c.name)}
        </button>
      ))}
    </div>
  );
}
