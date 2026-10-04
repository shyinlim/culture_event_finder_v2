import { useI18n } from '../i18n';

// The visible text (EN / 中) serves as the accessible name; aria-label is omitted per WCAG 2.5.3.
export function LanguageSwitch({ size }: { size: 'h-11 w-11' | 'h-9 w-9' }) {
  const { lang, setLang } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className={`btn-secondary ${size} rounded-full flex items-center justify-center text-sm font-semibold`}
    >
      {lang === 'zh' ? 'EN' : '中'}
    </button>
  );
}
