import { useEffect, useState } from 'react';
import { fetchCountries } from './api';
import { CategoryChips } from './components/CategoryChips';
import { CountryPicker } from './components/CountryPicker';
import { Scene } from './components/Scene';
import { SearchForm } from './components/SearchForm';
import { I18nProvider } from './i18n';
import type { Country, SearchForm as Form } from './types';
import { defaultForm } from './utils/format';

// Temporary preview page for Task 10c checkpoint verification.
function Preview() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    fetchCountries().then((list) => { setCountries(list); setForm(defaultForm(list[0], new Date())); });
  }, []);
  if (!form) return <p>loading countries...</p>;
  const country = countries[0];
  return (
    <main className="glass rounded-[40px] p-6 sm:p-10 max-w-5xl mx-auto my-6 text-[var(--text)]">
      <CountryPicker countries={countries} active={form.country} onPick={() => {}} />
      <pre className="text-xs my-4">{JSON.stringify(form)}</pre>
      <SearchForm form={form} country={country} ready loading={false}
        onChange={(p) => setForm({ ...form, ...p })} onSearch={() => console.log('search', form)} onReset={() => setForm(defaultForm(country, new Date()))} />
      <CategoryChips options={country.categories} selected={form.category} onPick={(v) => setForm({ ...form, category: v })} />
    </main>
  );
}

export function App() {
  return <I18nProvider><Scene /><Preview /></I18nProvider>;
}
