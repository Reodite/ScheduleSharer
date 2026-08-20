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
          <h2 className="homepage__section">Three kinds of links</h2>
          <dl className="homepage__links">
            <div>
              <dt>Public share link</dt>
              <dd>carries the whole schedule — everyone's courses included. Anyone who opens it sees the full calendar.</dd>
            </div>
            <div>
              <dt>Private share link 🔒</dt>
              <dd>
                carries only the schedule and its member ids — no names, no courses. It renders solely
                for people who already have those profiles; missing members fill in automatically once
                their profile links arrive.
              </dd>
            </div>
            <div>
              <dt>Profile link</dt>
              <dd>
                one person's schedule. Everyone you import collects on the <b>People</b> page, where
                you can build new schedules by selecting them.
              </dd>
            </div>
          </dl>

          <p className="homepage__note">
            No accounts, no backend — your data lives in your browser and inside the links you choose
            to share.
          </p>

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
