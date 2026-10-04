import { useEffect } from 'react';
import type { EventItem, EventShow } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

interface ShowTimesModalProps {
  event: EventItem | null;
  onClose: () => void;
}

const ZH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateHeading(dateStr: string, lang: 'zh' | 'en'): string {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const dayOfWeek = d.getDay();
  const weekday = lang === 'en' ? EN_WEEKDAYS[dayOfWeek] : ZH_WEEKDAYS[dayOfWeek];
  return `${dateStr} (${weekday})`;
}

function formatShowTime(show: EventShow): string {
  const startPart = show.startTime.split(' ')[1] || '';
  const startHm = startPart.slice(0, 5);
  if (!show.endTime) return startHm;
  const endPart = show.endTime.split(' ')[1] || '';
  const endHm = endPart.slice(0, 5);
  return endHm && endHm !== startHm ? `${startHm}–${endHm}` : startHm;
}

export function ShowTimesModal({ event, onClose }: ShowTimesModalProps) {
  const { lang, t } = useI18n();

  useEffect(() => {
    if (!event) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [event, onClose]);

  if (!event) return null;

  // Group shows by date (YYYY/MM/DD)
  const groupedShows: Record<string, EventShow[]> = {};
  for (const show of event.shows) {
    const dateKey = show.startTime.split(' ')[0];
    if (!groupedShows[dateKey]) {
      groupedShows[dateKey] = [];
    }
    groupedShows[dateKey].push(show);
  }

  const locationDisplay = event.locationName
    ? `${event.locationName}・${event.location}`
    : event.location;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity"
      onClick={onClose}
    >
      <div
        className="glass bg-white/95 dark:bg-[#0b0f19]/95 rounded-[32px] max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-[var(--panel-border)] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 pb-3 border-b border-[var(--panel-border-dim)] gap-3">
          <div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/10 text-[var(--text)] border border-[var(--panel-border-dim)]">
              {t('total_shows', { count: event.shows.length })}
            </span>
            <h3 id="modal-title" className="font-bold text-lg text-[var(--text)] mt-2">
              {event.title}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-1.5">
              <Icon name="pin" size={14} />
              <span>{locationDisplay}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 shrink-0 rounded-full bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            ✕
          </button>
        </div>

        {/* Showtimes List */}
        <div className="overflow-y-auto flex-1 pr-2 space-y-4">
          {Object.entries(groupedShows).map(([dateKey, shows]) => (
            <div key={dateKey}>
              <p className="text-xs font-bold text-[var(--link)] mb-2 uppercase tracking-wider">
                {formatDateHeading(dateKey, lang)}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {shows.map((show, idx) => (
                  <div
                    key={`${show.startTime}-${idx}`}
                    className="text-xs py-2 px-2.5 rounded-xl bg-slate-100/90 dark:bg-white/5 border border-slate-200/90 dark:border-white/10 font-mono font-medium text-[var(--text)] text-center shadow-xs"
                  >
                    {formatShowTime(show)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-4 mt-2 border-t border-[var(--panel-border-dim)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] font-medium">{t('modal_booking_hint')}</span>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary text-xs font-semibold px-5 py-2 rounded-full cursor-pointer transition"
          >
            {t('modal_close')}
          </button>
        </div>
      </div>
    </div>
  );
}
