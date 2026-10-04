import { useEffect, useState } from 'react';
import type { ErrorKind } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const PANEL = 'text-center py-24 px-4 bg-[var(--surface-2)] rounded-3xl border border-[var(--panel-border-dim)] border-dashed mt-4';

// Idle state shows helpful guide text before user executes any search.
export function IdleState() {
  const { t } = useI18n();
  return (
    <div data-testid="state-idle" className={PANEL}>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t('idle_title')}</p>
      <p className="text-[var(--text-muted)] text-sm max-w-sm mx-auto">{t('idle_desc')}</p>
    </div>
  );
}

// Switch message after 8 seconds so user knows upstream request is still in progress.
export function LoadingSkeleton() {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div data-testid="state-loading">
      <p role="status" className="text-sm text-[var(--text-muted)] mb-4">{t(slow ? 'loading_slow' : 'loading_short')}</p>
      <div aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-3xl bg-[var(--surface-2)] border border-[var(--panel-border-dim)] p-6 animate-pulse space-y-4">
            <div className="h-32 bg-[var(--skel)] rounded-2xl -m-6 mb-4" />
            <div className="h-5 bg-[var(--skel)] rounded w-3/4" />
            <div className="h-4 bg-[var(--skel)] rounded w-1/2" />
            <div className="h-4 bg-[var(--skel)] rounded w-2/3" />
            <div className="border-t border-[var(--panel-border-dim)] pt-4 mt-4">
              <div className="h-4 bg-[var(--skel)] rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Empty state provides a reset button so user can recover with one click.
export function EmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="state-empty" role="status" className={PANEL}>
      <svg className="mx-auto mb-5" style={{ width: 80, height: 80 }} viewBox="0 0 100 100" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" aria-hidden="true">
        <circle cx="44" cy="44" r="26" />
        <path d="M63 63 L84 84" strokeLinecap="round" />
        <path d="M44 10 V2 M44 86 v-8" strokeDasharray="2 4" />
        <path d="M8 44 H16 M72 44 h8" strokeDasharray="2 4" />
      </svg>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t('empty_title')}</p>
      <p className="text-[var(--text-muted)] text-sm max-w-sm mx-auto mb-6">{t('empty_desc')}</p>
      <button type="button" onClick={onReset} className="btn-secondary px-6 py-2.5 text-sm font-bold">
        {t('reset')}
      </button>
    </div>
  );
}

// Client errors (400/404) are not retried blindly, so onRetry is optional.
export function ErrorMessage({ kind, onRetry }: { kind: ErrorKind; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="state-error" role="alert" className={PANEL}>
      <svg className="mx-auto mb-5" style={{ width: 80, height: 80 }} viewBox="0 0 100 100" fill="none" stroke="var(--accent)" strokeWidth="1.5" aria-hidden="true">
        <path d="M50 12 L92 84 L8 84 Z" strokeLinejoin="round" />
        <path d="M50 38 V60" strokeLinecap="round" />
        <circle cx="50" cy="72" r="2" fill="var(--accent)" />
      </svg>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t(`error_${kind}_title`)}</p>
      <p className="text-[var(--text-muted)] text-sm mb-6">{t(`error_${kind}_desc`)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary px-6 py-2.5 text-sm font-bold inline-flex items-center gap-2">
          <Icon name="refresh" />{t('retry')}
        </button>
      )}
    </div>
  );
}
