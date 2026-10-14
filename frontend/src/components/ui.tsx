import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useI18n } from '../i18n';

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad';
const TONES: Record<Tone, string> = {
  neutral: 'bg-paper text-mute border-line', brand: 'bg-brand-soft text-brand-dark border-brand/30', good: 'bg-good-soft text-good border-good/30',
  warn: 'bg-warn-soft text-warn border-warn/30', bad: 'bg-bad-soft text-bad border-bad/30',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function DemoBadge() {
  const { t } = useI18n();
  return <Badge tone="warn">{t('DEMO')}</Badge>;
}

const STATUS_TONE: Record<string, Tone> = {
  new: 'neutral', matched: 'brand', low_match: 'neutral', saved: 'neutral', rejected: 'bad', draft_ready: 'brand', sent: 'good', failed: 'bad', draft: 'brand', sending: 'warn',
};
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{t(status)}</Badge>;
}

export function Button({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark border-brand', secondary: 'bg-white text-ink hover:bg-paper border-line',
    danger: 'bg-white text-bad hover:bg-bad-soft border-bad/40', ghost: 'bg-transparent text-brand hover:bg-brand-soft border-transparent',
  }[variant];
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />;
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function Spinner() {
  const { t } = useI18n();
  return <p role="status" className="py-8 text-center text-sm text-mute">{t('Loading')}…</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded border border-bad/40 bg-bad-soft p-3 text-sm text-bad">
      <p className="font-medium">{t('Something went wrong')}</p>
      <p>{message}</p>
      {onRetry && <Button className="mt-2" onClick={onRetry}>{t('Try again')}</Button>}
    </div>
  );
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'bad' | 'brand' | 'good'; children: ReactNode }) {
  return <div role={tone === 'bad' ? 'alert' : 'note'} className={`rounded border p-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-white p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-mute">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`mt-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-md bg-white shadow-xl`}>
        <header className="border-b border-line px-4 py-3"><h2 className="text-base font-semibold">{title}</h2></header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const SEG = ['#0e6b6e', '#2f8f83', '#6aa84f', '#c58b1f', '#8a6bb0', '#5b7fa8'];
export function ScoreMeter({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-mute">—</span>;
  const tone = score >= 75 ? 'bg-good' : score >= 50 ? 'bg-brand' : 'bg-warn';
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Score ${score} of 100`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line"><span className={`block h-full ${tone}`} style={{ width: `${score}%` }} /></span>
      <span className="w-7 text-sm font-semibold tabular-nums">{score}</span>
    </span>
  );
}
export const segmentColor = (i: number) => SEG[i % SEG.length]!;

export const fmtDate = (iso: string | null | undefined, lang = 'en') =>
  iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
