import type { EventItem } from '../types';
import { useI18n } from '../i18n';
import { buildGoogleMapUrl, buildGoogleSearchUrl, formatDateRange, formatPrice } from '../utils/format';
import { Icon } from './Icon';

// Three banner patterns used in rotation from POC v27.
const BANNERS = [
  {
    background: 'linear-gradient(135deg,#c2410c,#d97706)',
    shapes: <><circle cx="248" cy="20" r="38" /><circle cx="248" cy="20" r="24" strokeDasharray="3 5" /><path d="M30 92 L58 44 L86 92 Z" /><path d="M140 20 V44 M128 32 H152" strokeWidth="1.6" /></>,
  },
  {
    background: 'linear-gradient(135deg,#1e3a8a,#3b82f6)',
    shapes: <><rect x="220" y="18" width="52" height="52" transform="rotate(16 246 44)" /><path d="M20 30 A46 46 0 0 1 66 76" strokeDasharray="3 5" /><path d="M120 84 C150 40 200 96 244 60" strokeDasharray="1 7" strokeLinecap="round" /></>,
  },
  {
    background: 'linear-gradient(135deg,#0d9488,#115e59)',
    shapes: <><path d="M252 14 C255 34 262 41 282 44 C262 47 255 54 252 74 C249 54 242 47 222 44 C242 41 249 34 252 14 Z" /><circle cx="52" cy="76" r="30" /><circle cx="52" cy="76" r="18" strokeDasharray="3 5" /><path d="M140 26 L166 70 L114 70 Z" /></>,
  },
];

export function EventCard({
  event,
  index,
  onOpenShowtimes,
}: {
  event: EventItem;
  index: number;
  onOpenShowtimes?: (event: EventItem) => void;
}) {
  const { lang, t } = useI18n();
  const banner = BANNERS[index % BANNERS.length];

  return (
    <article className="card-hover group flex flex-col h-full rounded-3xl overflow-hidden bg-[var(--surface-2)] border border-[var(--panel-border-dim)] transition-all duration-300">
      <div className="h-32 shrink-0 relative flex items-end p-4 overflow-hidden" style={{ background: banner.background }}>
        <svg className="card-img-svg absolute inset-0 w-full h-full" viewBox="0 0 300 128" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.2" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {banner.shapes}
        </svg>
        {/* Show on-sale badge only when onSales is true */}
        {event.onSales && (
          <span className="relative text-xs font-semibold bg-black/50 backdrop-blur-md text-white px-3 py-1.5 rounded-full shadow-sm">
            {t('on_sales')}
          </span>
        )}
      </div>
      <div className="p-6 flex flex-col flex-1">
        <h3 className="font-bold text-lg leading-snug mb-3 text-[var(--text)] group-hover:text-[var(--link)] transition-colors line-clamp-2 min-h-[3.25rem]">
          {event.title}
        </h3>
        <div className="flex items-center justify-between text-sm text-[var(--text-muted)] mb-3 min-h-[28px]">
          <span className="flex items-center gap-2">
            <Icon name="calendar" size={16} />
            <span>{formatDateRange(event.startTime, event.endTime)}</span>
          </span>
          {event.shows && event.shows.length > 1 && onOpenShowtimes && (
            <button
              type="button"
              onClick={() => onOpenShowtimes(event)}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--panel-border-dim)] text-[var(--text)] hover:text-white hover:border-[var(--accent)] transition cursor-pointer"
            >
              {t('show_count_badge', { count: event.shows.length })}
            </button>
          )}
        </div>
        <a
          href={buildGoogleMapUrl(event.location, event.locationName)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm hover:underline flex items-start gap-2 mb-5"
          style={{ color: 'var(--link)' }}
        >
          <span className="shrink-0 mt-0.5">
            <Icon name="pin" size={16} />
          </span>
          <span className="leading-relaxed line-clamp-2 min-h-[3rem]">{event.locationName ? `${event.locationName}・${event.location}` : event.location}</span>
        </a>
        <div className="flex items-center justify-between border-t border-[var(--panel-border-dim)] pt-4 mt-auto gap-3">
          <p className="text-sm font-bold text-[var(--text)]">{formatPrice(event.price, lang)}</p>
          <a
            href={buildGoogleSearchUrl(event.title)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-white/10 transition"
          >
            {t('google_search')}
          </a>
        </div>
      </div>
    </article>
  );
}
