import type { LabeledOption } from '../types';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './Icon';

// Four quick shortcut chips matching the POC design icons.
const SHORTCUTS: { value: string; icon: IconName }[] = [
  { value: '6', icon: 'frame' },
  { value: '2', icon: 'masks' },
  { value: '1', icon: 'music' },
  { value: '17', icon: 'tent' },
];

export function CategoryChips({ options, selected, onPick }: {
  options: LabeledOption[];
  selected: string;
  onPick: (value: string) => void;
}) {
  const { t, label } = useI18n();
  return (
    <div data-testid="category-chips" role="group" aria-label={t('quick_categories')} className="flex flex-wrap gap-2.5 mb-8">
      {SHORTCUTS.map(({ value, icon }) => {
        // Compare string values so backend numeric values match safely.
        const option = options.find((o) => String(o.value) === value);
        if (!option) return null;
        const isActive = String(selected) === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onPick(value)}
            className={`chip flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium ${isActive ? 'btn-primary active' : 'btn-secondary'}`}
          >
            <Icon name={icon} size={14} />{label(option)}
          </button>
        );
      })}
    </div>
  );
}
