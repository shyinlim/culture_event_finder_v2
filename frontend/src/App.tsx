import { I18nProvider } from './i18n';
import { Scene } from './components/Scene';
import { EmptyState, ErrorMessage, IdleState, LoadingSkeleton } from './components/StatePanels';

// Temporary preview page for Task 10a checkpoint verification.
export function App() {
  return (
    <I18nProvider>
      <Scene />
      <main className="glass rounded-[40px] p-6 sm:p-10 max-w-5xl mx-auto my-6 text-[var(--text)] space-y-6">
        <IdleState />
        <LoadingSkeleton />
        <EmptyState onReset={() => {}} />
        <ErrorMessage kind="upstream" onRetry={() => {}} />
        <ErrorMessage kind="client" />
      </main>
    </I18nProvider>
  );
}
