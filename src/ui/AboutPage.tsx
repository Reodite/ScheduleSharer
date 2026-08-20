import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

/**
 * About page (#about) — where the wordmark leads. What the app is, how the
 * three link kinds work, and a way back to the calendar.
 */
export function AboutPage({ onClose }: Props) {
  // fixed full-screen page — lock the calendar's scrollbar away while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="aboutpage">
      <header className="aboutpage__head">
        <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Back to calendar" title="Back to calendar">
          ←
        </button>
      </header>

      <div className="aboutpage__body">
        <div className="aboutpage__inner">
          <h1 className="aboutpage__wordmark">
            Reodite <em>Schedules</em>
          </h1>
          <p className="aboutpage__tagline">every schedule · one master grid</p>

          <p className="aboutpage__lead">
            Drop in your Workday schedule export and share one link with the group chat — everyone's
            courses land on a single weekly calendar. See who's in your lectures, when everyone's
            free, and who's in class right now on the campus map. No accounts, no backend: your data
            lives in your browser and inside the links you choose to share.
          </p>

          <h2 className="aboutpage__section">Getting started</h2>
          <ol className="aboutpage__steps">
            <li>
              In Workday: <b>Academics → Registration &amp; Courses → View Saved Schedule</b>, export to Excel.
            </li>
            <li>Drop the .xlsx on the calendar and pick a handle + avatar.</li>
            <li>Copy a share link and send it to the chat — friends add theirs and share back.</li>
          </ol>

          <h2 className="aboutpage__section">Three kinds of links</h2>
          <dl className="aboutpage__links">
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

          <button type="button" className="btn btn--primary aboutpage__cta" onClick={onClose}>
            Open the calendar →
          </button>

          <footer className="aboutpage__foot">
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
