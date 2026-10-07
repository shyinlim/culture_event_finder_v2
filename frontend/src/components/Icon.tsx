import type { ReactNode } from 'react';

export type IconName =
  | 'search' | 'info' | 'moon' | 'sun' | 'calendar' | 'pin' | 'ticket' | 'refresh'
  | 'music' | 'tent' | 'masks' | 'frame' | 'arrow-up';

const SHAPES: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  pin: <><path d="M12 22s7-7.4 7-12.6A7 7 0 0 0 5 9.4C5 14.6 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.3" /></>,
  ticket: <><path d="M3 9a2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" /><path d="M12 5v14" strokeDasharray="2 3" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  tent: <><path d="M19 20L12 4 5 20" /><path d="M12 15L9 20h6z" /></>,
  masks: <><path d="M4 10c0-4 4-8 8-8s8 4 8 8c0 5-4 10-8 10-4 0-8-5-8-10z" /><path d="M9 9h.01M15 9h.01M12 14c-1 0-2 .5-2 1h4c0-.5-1-1-2-1z" /></>,
  frame: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M3 9h18M9 21V9" /></>,
  'arrow-up': <path d="M12 19V5M5 12l7-7 7 7" />,
};

// Purely decorative icon: button text or aria-label provides accessible names for screen readers.
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" style={{ width: size, height: size }} viewBox="0 0 24 24" aria-hidden="true">
      {SHAPES[name]}
    </svg>
  );
}
