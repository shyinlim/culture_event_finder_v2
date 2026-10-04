import { useCallback, useEffect, useRef, useState } from 'react';
import { errorKind, fetchCountries, searchEvents, type ErrorKind } from './api';
import { About } from './components/About';
import { CategoryChips } from './components/CategoryChips';
import { CountryPicker } from './components/CountryPicker';
import { EventList } from './components/EventList';
import { Icon } from './components/Icon';
import { LanguageSwitch } from './components/LanguageSwitch';
import { Scene } from './components/Scene';
import { SearchForm } from './components/SearchForm';
import { ShowTimesModal } from './components/ShowTimesModal';
import { EmptyState, ErrorMessage, IdleState, LoadingSkeleton } from './components/StatePanels';
import { I18nProvider, useI18n } from './i18n';
import { useTheme } from './theme';
import type { Country, EventItem, SearchForm as Form } from './types';
import { defaultForm, findLabel } from './utils/format';

type View = 'search' | 'about';
type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error';

function MainApp() {
  const { t, label } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [view, setView] = useState<View>('search');
  const [countries, setCountries] = useState<Country[]>([]);
  const [loadError, setLoadError] = useState<ErrorKind | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [searchError, setSearchError] = useState<ErrorKind>('transient');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [searched, setSearched] = useState<Form | null>(null);
  const [modalEvent, setModalEvent] = useState<EventItem | null>(null);
  const searchCtrl = useRef<AbortController | null>(null);

  const country = countries.find((c) => c.code === form?.country);

  // Load countries list for select options.
  const loadCountries = useCallback((signal?: AbortSignal) => {
    setLoadError(null);
    fetchCountries(signal)
      .then((list) => {
        setCountries(list);
        setForm(defaultForm(list[0], new Date()));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoadError(errorKind(err));
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadCountries(ctrl.signal);
    return () => ctrl.abort();
  }, [loadCountries]);

  // Run search: abort any ongoing request before issuing a new one to prevent stale overwrites.
  const runSearch = (query: Form) => {
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setStatus('loading');
    searchEvents(query, ctrl.signal)
      .then((res) => {
        setEvents(res.events);
        setSearched(query);
        setStatus(res.events.length > 0 ? 'results' : 'empty');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setSearched(query);
        setSearchError(errorKind(err));
        setStatus('error');
      });
  };

  const pickCategory = (value: string) => {
    if (!form) return;
    const next = { ...form, category: value };
    setForm(next);
    runSearch(next);
  };

  const pickCountry = (code: string) => {
    const next = countries.find((c) => c.code === code);
    if (next) setForm(defaultForm(next, new Date()));
  };

  const reset = () => {
    if (!country) return;
    const next = defaultForm(country, new Date());
    setForm(next);
    runSearch(next);
  };

  // Sync navigation view with browser history so mobile back button returns cleanly.
  const navigate = (next: View) => {
    if (next === view) return;
    window.history.pushState({ view: next }, '');
    setView(next);
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => setView(e.state?.view === 'about' ? 'about' : 'search');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Summary line shows applied query filters and count.
  const summary = searched && country
    ? t('result_count', {
        place: label(findLabel(country.locations, searched.location) ?? { zh: searched.location, en: searched.location }),
        category: label(findLabel(country.categories, searched.category) ?? { zh: searched.category, en: searched.category }),
        ym: `${searched.year}/${searched.month}`,
        count: events.length,
      })
    : '';

  const navButton = (target: View, icon: 'search' | 'info', size: string) => (
    <button
      type="button"
      onClick={() => navigate(target)}
      aria-label={t(target === 'search' ? 'nav_search' : 'nav_about')}
      aria-current={view === target ? 'page' : undefined}
      className={`rail-btn ${view === target ? 'active' : ''} ${size} rounded-full flex items-center justify-center transition hover:bg-[var(--surface-2)]`}
    >
      <Icon name={icon} />
    </button>
  );

  const themeButton = (size: string) => (
    <button type="button" onClick={toggleTheme} aria-label={t('theme_toggle')}
      className={`${size} rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]`}>
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 flex gap-4 text-[var(--text)]">
      {/* Desktop: left floating icon rail */}
      <aside className="glass hidden sm:flex flex-col items-center gap-3 rounded-full px-2.5 py-5 h-fit sticky top-6">
        {navButton('search', 'search', 'h-11 w-11')}
        {navButton('about', 'info', 'h-11 w-11')}
        <div className="w-6 h-px bg-[var(--panel-border-dim)] my-2" />
        {themeButton('h-11 w-11')}
        <LanguageSwitch size="h-11 w-11" />
      </aside>

      <div className="flex-1 min-w-0">
        {/* Mobile: top nav bar with language switch */}
        <nav className="glass sm:hidden flex items-center justify-end gap-2 rounded-3xl px-4 py-3 mb-5">
          {navButton('search', 'search', 'h-9 w-9')}
          {navButton('about', 'info', 'h-9 w-9')}
          {themeButton('h-9 w-9')}
          <LanguageSwitch size="h-9 w-9" />
        </nav>

        {/* Single top-level h1 heading present in all views */}
        <h1 className="font-bold text-xl sm:text-2xl flex items-center gap-3 tracking-tight mb-5">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--surface-2)] border border-[var(--panel-border-dim)]">
            <Icon name="ticket" />
          </span>
          {t('app_title')}
        </h1>

        {view === 'about' ? <About /> : (
          <main className="glass rounded-[40px] p-6 sm:p-10 shadow-2xl">
            {loadError && <ErrorMessage kind={loadError} onRetry={() => loadCountries()} />}

            {!loadError && !form && <LoadingSkeleton />}

            {form && country && (
              <>
                <div className="flex justify-end mb-6">
                  <CountryPicker countries={countries} active={form.country} onPick={pickCountry} />
                </div>
                <SearchForm
                  form={form}
                  country={country}
                  ready
                  loading={status === 'loading'}
                  onChange={(patch) => setForm({ ...form, ...patch })}
                  onSearch={() => runSearch(form)}
                  onReset={reset}
                />
                <CategoryChips options={country.categories} selected={form.category} onPick={pickCategory} />

                {status === 'idle' && <IdleState />}
                {status === 'loading' && <LoadingSkeleton />}
                {status === 'empty' && <EmptyState onReset={reset} />}
                {status === 'error' && (
                  <ErrorMessage
                    kind={searchError}
                    onRetry={searchError === 'client' || !searched ? undefined : () => runSearch(searched)}
                  />
                )}
                {status === 'results' && (
                  <>
                    <p className="text-sm text-[var(--text-muted)] mb-4">{summary}</p>
                    <EventList events={events} onOpenShowtimes={(ev) => setModalEvent(ev)} />
                  </>
                )}
              </>
            )}
          </main>
        )}
        <ShowTimesModal event={modalEvent} onClose={() => setModalEvent(null)} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Scene />
      <MainApp />
    </I18nProvider>
  );
}
