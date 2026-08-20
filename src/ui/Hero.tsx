import type { Schedule } from '../types';
import { DropZone } from './DropZone';

interface Props {
  onParsed: (schedule: Schedule, fileName: string) => void;
}

/**
 * The classic landing block: pitch, working drop zone, and the three steps.
 * Shown as the calendar's empty state AND at the top of the #home page.
 */
export function Hero({ onParsed }: Props) {
  return (
    <div className="hero">
      <h1>
        Every schedule.
        <br />
        One <em>master grid</em>.
      </h1>
      <DropZone hero onParsed={onParsed} />
      <div className="hero__steps">
        <span className="hero__step">
          <b>01</b> export .xlsx from Workday
        </span>
        <span className="hero__step">
          <b>02</b> drop it here · pick a handle
        </span>
        <span className="hero__step">
          <b>03</b> copy the link · send to the chat
        </span>
      </div>
    </div>
  );
}
