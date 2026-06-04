import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayCode, Person, Schedule } from '../src/types';
import { useStore } from './state/store';
import { importIntoLibrary } from './state/library';
import { decodeShareHash, ShareDecodeError } from './state/shareLink';
import { deriveTerms, defaultTermKey } from './features/terms';
import { buildCalendar, expandBlocks } from './calendar/buildCalendar';
import type { MergedBlock } from './calendar/buildCalendar';
import { commonFreeIntervals } from './features/freeTime';
import { WeekGrid } from './calendar/WeekGrid';
import { BlockDetail } from './calendar/BlockDetail';
import { TermSwitcher } from './features/TermSwitcher';
import { PeoplePanel } from './features/PeoplePanel';
import { NowPanel } from './features/NowPanel';
import { DropZone } from './ui/DropZone';
import { ShareBar } from './ui/ShareBar';
import { ProfileModal } from './ui/ProfileModal';
import type { ProfileDraft } from './ui/ProfileModal';
import { ScheduleManager } from './ui/ScheduleManager';
import { useToast } from './ui/Toast';
import { dayCodeOf, minutesToFullLabel, toISODate } from './util/time';

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function App() {
  const { library, group, dispatch, bootImport } = useStore();
  const toast = useToast();
  const now = useNow();

  const [termKey, setTermKey] = useState<string | null>(null);
  const [showFree, setShowFree] = useState(true);
  const [showManager, setShowManager] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [detail, setDetail] = useState<MergedBlock | null>(null);
  const [mobileDay, setMobileDay] = useState<DayCode>(() => {
    const d = dayCodeOf(new Date());
    return d === 'Sat' || d === 'Sun' ? 'Mon' : d;
  });

  // one-time boot feedback for an incoming share link
  const bootToastShown = useRef(false);
  useEffect(() => {
    if (!bootImport || bootToastShown.current) return;
    bootToastShown.current = true;
    if (bootImport.error) toast(bootImport.error, 'error');
    else if (bootImport.outcome === 'full')
      toast('Schedule cache is full (5/5) — delete one from the schedule menu, then reopen the link.', 'error');
    else if (bootImport.outcome === 'added')
      toast(`Saved new schedule "${bootImport.groupName || 'Untitled'}" from the link 🎉`);
    else if (bootImport.importedPeople.length > 0)
      toast(`Added from share link: ${bootImport.importedPeople.join(', ')} 🎉`);
    else toast('Share link opened — everyone here was already up to date');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening a new share link in an already-open tab only changes the hash —
  // no reload, so boot() never sees it. Route it on hashchange instead.
  useEffect(() => {
    function onHashChange() {
      try {
        const incoming = decodeShareHash(window.location.hash);
        if (!incoming) return;
        const { outcome } = importIntoLibrary(library, incoming);
        if (outcome === 'full') {
          toast('Schedule cache is full (5/5) — delete one from the schedule menu, then reopen the link.', 'error');
          return;
        }
        dispatch({ type: 'importIncoming', incoming });
        toast(
          outcome === 'added'
            ? `Saved new schedule "${incoming.name || 'Untitled'}" from the link 🎉`
            : 'Share link merged into your calendar',
        );
      } catch (e) {
        if (e instanceof ShareDecodeError) toast(e.message, 'error');
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [library, dispatch, toast]);

  const terms = useMemo(() => deriveTerms(group.people), [group.people]);
  const selectedTermKey = termKey && terms.some((t) => t.key === termKey)
    ? termKey
    : defaultTermKey(terms, toISODate(now));
  const term = terms.find((t) => t.key === selectedTermKey) ?? null;

  const model = useMemo(() => buildCalendar(group.people, term), [group.people, term]);

  const freeBands = useMemo(() => {
    if (!showFree) return [];
    const enabled = group.people.filter((p) => p.enabled && p.schedule);
    if (enabled.length === 0) return [];
    return commonFreeIntervals(expandBlocks(enabled, term), model.days);
  }, [showFree, group.people, term, model.days]);

  const termIsLive = !!term && toISODate(now) >= term.start && toISODate(now) <= term.end;

  function savePerson(handle: string, avatar: Person['avatar']) {
    if (!draft) return;
    if (draft.person) {
      dispatch({ type: 'editPerson', id: draft.person.id, handle, avatar });
      toast(`Saved ${handle}`);
    } else if (draft.schedule) {
      const person: Person = {
        id: crypto.randomUUID(),
        handle,
        avatar,
        schedule: draft.schedule,
        updatedAt: new Date().toISOString(),
        enabled: true,
      };
      dispatch({ type: 'addPerson', person });
      toast(`${handle} is on the calendar — hit "Copy share link" to pass it on`);
    }
    setDraft(null);
  }

  function onParsed(schedule: Schedule, _fileName: string) {
    setDraft({ schedule });
  }

  const empty = group.people.length === 0;

  return (
    <>
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark__name">
            Schedule<em>Sharer</em>
          </span>
        </div>
        <button
          type="button"
          className="btn sched-btn"
          title="Switch, rename, or delete cached schedules"
          onClick={() => setShowManager(true)}
        >
          {group.name || 'Untitled schedule'}
          <span className="sched-btn__caret">▾</span>
        </button>
        <div className="topbar__spacer" />
        <TermSwitcher terms={terms} selected={selectedTermKey} onSelect={setTermKey} />
        <ShareBar />
      </header>

      {empty ? (
        <div className="hero">
          <h1>
            Every schedule.
            <br />
            One <em>master grid</em>.
          </h1>
          <p>
            Drop in your Workday schedule export, pick a handle, and share one link with the group
            chat. Everyone's courses land on a single weekly calendar — see who's in your lectures,
            when everyone's free, and who's in class right now.
          </p>
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
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <DropZone onParsed={onParsed} />
            <PeoplePanel onEdit={(person) => setDraft({ person })} />
            <div className="panel">
              <label className={`toggle-row${showFree ? ' toggle-row--on' : ''}`}>
                <input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} />
                Highlight common free time
              </label>
              {showFree && freeBands.length > 0 && (
                <div className="free-list">
                  {freeBands.map((f) => (
                    <span key={`${f.day}${f.startMin}`}>
                      <span className="free-list__day">{f.day}</span>
                      {minutesToFullLabel(f.startMin)} – {minutesToFullLabel(f.endMin)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {termIsLive && <NowPanel people={group.people} now={now} />}
          </aside>

          <main className="cal-wrap">
            <div className="day-tabs">
              {model.days.map((d) => (
                <button key={d} type="button" className={d === mobileDay ? 'sel' : ''} onClick={() => setMobileDay(d)}>
                  {d}
                </button>
              ))}
            </div>
            <WeekGrid
              model={model}
              freeBands={freeBands}
              now={now}
              termIsLive={termIsLive}
              activeDay={mobileDay}
              onBlockClick={setDetail}
            />
          </main>
        </div>
      )}

      {showManager && <ScheduleManager onClose={() => setShowManager(false)} />}
      {draft && (
        <ProfileModal
          draft={draft}
          takenHandles={group.people.filter((p) => p.id !== draft.person?.id).map((p) => p.handle)}
          onSave={savePerson}
          onCancel={() => setDraft(null)}
        />
      )}
      {detail && <BlockDetail block={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
