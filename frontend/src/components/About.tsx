import { useI18n } from '../i18n';

const STACK = [
  ['Django 5.2 LTS', 'Backend'],
  ['uv', 'Python dependencies'],
  ['toolkitsy', 'Logging'],
  ['React + TypeScript', 'Frontend'],
  ['Vite', 'Frontend build tool'],
  ['Tailwind CSS', 'Styling'],
  ['pytest', 'Backend tests'],
  ['Vitest', 'Frontend tests'],
  ['Render', 'Hosting'],
];

export function About() {
  const { t } = useI18n();
  return (
    <section className="glass rounded-[40px] p-6 sm:p-10 shadow-2xl">
      <h2 className="text-2xl font-bold mb-5 text-[var(--text)]">{t('about_title')}</h2>
      <p className="text-base text-[var(--text-muted)] leading-relaxed mb-8 max-w-2xl">{t('about_desc')}</p>
      <h3 className="font-bold text-lg mb-4 text-[var(--text)]">Tech Stack</h3>
      <div className="rounded-3xl overflow-hidden mb-8 border border-[var(--panel-border-dim)] divide-y divide-[var(--panel-border-dim)] max-w-2xl">
        {STACK.map(([name, role], i) => (
          <div key={name} className={`flex p-4 text-sm ${i % 2 === 0 ? 'bg-[var(--surface-2)]' : ''}`}>
            <span className="w-48 font-bold text-[var(--text)]">{name}</span>
            <span className="text-[var(--text-muted)]">{role}</span>
          </div>
        ))}
      </div>
      <p className="text-sm font-semibold text-[var(--text-muted)] pt-4 border-t border-[var(--panel-border-dim)]">
        {t('about_author')}：
        <a href="https://github.com/shyinlim/culture_event_finder_v2" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--link)' }}>
          GitHub
        </a>
      </p>
    </section>
  );
}
