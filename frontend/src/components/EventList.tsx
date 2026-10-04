import type { EventItem } from '../types';
import { EventCard } from './EventCard';

// role="status" ensures screen readers announce updated search results.
export function EventList({ events }: { events: EventItem[] }) {
  return (
    <div data-testid="results-grid" role="status" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event, index) => <EventCard key={event.id} event={event} index={index} />)}
    </div>
  );
}
