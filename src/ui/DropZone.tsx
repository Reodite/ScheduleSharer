import { useRef, useState } from 'react';
import type { Schedule } from '../types';
import { parseScheduleXlsx } from '../parse/scheduleParser';
import { useToast } from './Toast';

interface Props {
  onParsed: (schedule: Schedule, fileName: string) => void;
  hero?: boolean;
}

export function DropZone({ onParsed, hero }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const toast = useToast();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast('That needs to be the .xlsx file exported from Workday.', 'error');
      return;
    }
    try {
      const schedule = parseScheduleXlsx(await file.arrayBuffer(), file.name);
      onParsed(schedule, file.name);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not parse that file.', 'error');
    }
  }

  return (
    <>
      <button
        type="button"
        className={`dropzone${over ? ' dropzone--over' : ''}${hero ? ' dropzone--hero' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
      >
        {hero ? (
          <>
            Drop your Workday schedule here
            <br />
            <strong>View Saved Schedule → export to Excel (.xlsx)</strong>
            <br />
            or click to browse
          </>
        ) : (
          <>
            <strong>+ Add a schedule</strong>
            <br />
            drop a Workday .xlsx or click
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
