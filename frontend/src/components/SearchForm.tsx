import type { Country, LabeledOption, SearchForm as Form } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function Field({ id, title, value, options, onChange }: {
  id: string;
  title: string;
  value: string;
  options: { value: string; text: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="search-field has-select">
      <label htmlFor={id} className="search-label">{title}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="search-select pr-6">
        {options.map((o) => <option key={o.value} value={o.value} className="text-black">{o.text}</option>)}
      </select>
    </div>
  );
}

// Select year and month explicitly instead of input type="month" for cross-browser reliability.
export function SearchForm({ form, country, ready, loading, onChange, onSearch, onReset }: {
  form: Form;
  country: Country;
  ready: boolean;
  loading: boolean;
  onChange: (patch: Partial<Form>) => void;
  onSearch: () => void;
  onReset: () => void;
}) {
  const { t, label } = useI18n();
  const toOptions = (list: LabeledOption[]) => list.map((o) => ({ value: String(o.value), text: label(o) }));
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear + 1].map((y) => ({ value: String(y), text: String(y) }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSearch(); }}
      className="search-capsule mb-4 flex-col sm:flex-row rounded-3xl sm:rounded-full"
    >
      <Field id="f-location" title={t('location')} value={form.location} options={toOptions(country.locations)} onChange={(v) => onChange({ location: v })} />
      <Field id="f-category" title={t('category')} value={form.category} options={toOptions(country.categories)} onChange={(v) => onChange({ category: v })} />
      <Field id="f-year" title={t('year')} value={form.year} options={years} onChange={(v) => onChange({ year: v })} />
      <Field id="f-month" title={t('month')} value={form.month} options={MONTHS.map((m) => ({ value: m, text: m }))} onChange={(v) => onChange({ month: v })} />
      <div className="p-3 sm:p-2 flex items-center justify-center gap-2">
        <button type="button" onClick={onReset} className="btn-secondary h-12 px-4 text-sm">{t('reset')}</button>
        {/* Disable submit until countries are loaded to avoid malformed requests */}
        <button
          type="submit"
          data-testid="search-button"
          disabled={!ready || loading}
          aria-label={t('search')}
          className="btn-primary w-full sm:w-12 h-12 rounded-2xl sm:rounded-full flex items-center justify-center text-sm gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="search" />
          <span className="sm:hidden font-semibold">{t('search')}</span>
        </button>
      </div>
    </form>
  );
}
