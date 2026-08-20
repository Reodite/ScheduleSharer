import { useEffect } from 'react';
import type { Schedule } from '../types';
import { Hero } from './Hero';

interface Props {
  onClose: () => void;
  /** dropping an xlsx here works exactly like on the calendar's empty state */
  onParsed: (schedule: Schedule, fileName: string) => void;
}

/**
 * Home page (#home) — where the wordmark leads. The classic hero (pitch,
 * working drop zone, upload steps) with the app explainer beneath it.
 */
export function HomePage({ onClose, onParsed }: Props) {
  // fixed full-screen page — lock the calendar's scrollbar away while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="homepage">
      <header className="homepage__head">
        <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Back to calendar" title="Back to calendar">
          ←
        </button>
      </header>

      <div className="homepage__body">
        <Hero onParsed={onParsed} />

        <div className="homepage__inner">
          <button type="button" className="btn btn--primary homepage__cta" onClick={onClose}>
            Open the calendar →
          </button>

          <footer className="homepage__foot">
            a{' '}
            <a href="https://reodite.com" target="_blank" rel="noreferrer">
              Reodite
            </a>{' '}
            project ·{' '}
            <a href="https://github.com/Reodite/ScheduleSharer" target="_blank" rel="noreferrer">
              source on GitHub
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
