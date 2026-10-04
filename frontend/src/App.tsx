import { I18nProvider } from './i18n';
import { Scene } from './components/Scene';
import { EventList } from './components/EventList';
import { EmptyState, ErrorMessage, IdleState, LoadingSkeleton } from './components/StatePanels';
import type { EventItem } from './types';

const SAMPLE: EventItem[] = [
  { id: 'a', title: '臺北當代藝術館：光影展', startTime: '2026/01/01 10:00:00', endTime: '2026/12/31 18:00:00', location: '臺北市大同區長安西路39號', locationName: '臺北當代藝術館', onSales: true, price: '300' },
  { id: 'b', title: '國家音樂廳：夏夜交響', startTime: '2026/07/22 19:30:00', endTime: '2026/07/22 21:30:00', location: '臺北市中正區中山南路21-1號', locationName: '國家音樂廳', onSales: false, price: '洽詢主辦單位' },
  { id: 'c', title: '松山文創園區：手作市集 & 工作坊 #3', startTime: '2026/07/25 10:00:00', endTime: null, location: '臺北市信義區光復南路133號', locationName: '', onSales: false, price: '0' },
];

// Temporary preview page for Task 10b checkpoint verification.
export function App() {
  return (
    <I18nProvider>
      <Scene />
      <main className="glass rounded-[40px] p-6 sm:p-10 max-w-5xl mx-auto my-6 text-[var(--text)] space-y-6">
        <EventList events={SAMPLE} />
        <IdleState />
        <LoadingSkeleton />
        <EmptyState onReset={() => {}} />
        <ErrorMessage kind="upstream" onRetry={() => {}} />
        <ErrorMessage kind="client" />
      </main>
    </I18nProvider>
  );
}
