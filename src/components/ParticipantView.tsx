import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  HelpCircle,
  PauseCircle,
  Pencil,
  UserCheck,
  X,
} from 'lucide-react';
import { useRealtimeSession } from '../hooks/useRealtimeSession';
import { formatDuration } from '../utils/time';

const STORAGE_ID_KEY = 'beacondesk_participant_id';
const STORAGE_NAME_KEY = 'beacondesk_participant_name';
const STORAGE_STATION_KEY = 'beacondesk_participant_station';
const STORAGE_TOUR_DONE_KEY = 'beacondesk_participant_tour_done';

function getOrCreateParticipantId(): string {
  const existing = localStorage.getItem(STORAGE_ID_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(STORAGE_ID_KEY, fresh);
  return fresh;
}

export const ParticipantView: React.FC = () => {
  const [participantId] = useState<string>(() => getOrCreateParticipantId());
  const [savedName, setSavedName] = useState<string>(
    () => localStorage.getItem(STORAGE_NAME_KEY) || ''
  );
  const [savedStation, setSavedStation] = useState<string>(
    () => localStorage.getItem(STORAGE_STATION_KEY) || ''
  );
  const [tourCompleted, setTourCompleted] = useState<boolean>(
    () => localStorage.getItem(STORAGE_TOUR_DONE_KEY) === 'true'
  );

  // Tour state: step 1 (Enter Name) -> step 2 (How Call Button Works)
  const [tourStep, setTourStep] = useState<1 | 2>(() => {
    const hasName = Boolean(localStorage.getItem(STORAGE_NAME_KEY));
    return hasName ? 2 : 1;
  });

  const [nameInput, setNameInput] = useState<string>(savedName);
  const [stationInput, setStationInput] = useState<string>(savedStation);
  const [noteInput, setNoteInput] = useState<string>('');
  const [editingProfile, setEditingProfile] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [recentResolvedNotice, setRecentResolvedNotice] = useState<string>('');
  const [now, setNow] = useState<number>(() => Date.now());

  const realtimeIdentity = useMemo(() => {
    if (!savedName.trim()) return null;
    return {
      role: 'participant' as const,
      id: participantId,
      name: savedName.trim(),
      station: savedStation.trim(),
    };
  }, [participantId, savedName, savedStation]);

  const { snapshot, connected } = useRealtimeSession({
    identity: realtimeIdentity,
    onCallUpdated: (call, prev) => {
      if (
        call.participantId === participantId &&
        call.status === 'resolved' &&
        prev &&
        prev.status !== 'resolved'
      ) {
        const by = call.resolvedByFacilitatorName || 'A facilitator';
        setRecentResolvedNotice(`Marked resolved by ${by}. Press anytime if another question comes up.`);
      }
    },
  });

  // Find active call for this participant
  const activeCall = useMemo(() => {
    return snapshot.calls.find(
      (c) =>
        c.participantId === participantId &&
        (c.status === 'calling' || c.status === 'claimed')
    );
  }, [snapshot.calls, participantId]);

  const onlineFacilitatorCount = useMemo(
    () => snapshot.facilitators.filter((f) => f.online).length,
    [snapshot.facilitators]
  );

  useEffect(() => {
    if (!activeCall) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeCall]);

  const handleSaveIdentity = async (e: React.FormEvent, completeTourAfter = false) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setErrorMsg('Please enter your name so facilitators know who you are.');
      return;
    }

    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/participants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: participantId,
          name: trimmed,
          station: stationInput.trim(),
          tourCompleted: completeTourAfter ? true : tourCompleted,
        }),
      });
      if (!res.ok) {
        throw new Error('Could not register your name. Please try again.');
      }
      localStorage.setItem(STORAGE_NAME_KEY, trimmed);
      localStorage.setItem(STORAGE_STATION_KEY, stationInput.trim());
      setSavedName(trimmed);
      setSavedStation(stationInput.trim());
      setEditingProfile(false);

      if (!tourCompleted) {
        setTourStep(2);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishTour = async () => {
    localStorage.setItem(STORAGE_TOUR_DONE_KEY, 'true');
    setTourCompleted(true);
    try {
      await fetch('/api/participants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: participantId,
          name: savedName,
          station: savedStation,
          tourCompleted: true,
        }),
      });
    } catch {
      // Non-blocking
    }
  };

  const handleReplayTour = () => {
    setTourCompleted(false);
    setTourStep(1);
  };

  const handleCallFacilitator = async () => {
    if (!savedName.trim() || submitting || snapshot.callsPaused) return;
    setErrorMsg('');
    setRecentResolvedNotice('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId,
          participantName: savedName.trim(),
          station: savedStation.trim(),
          note: noteInput.trim(),
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errData?.error || 'Could not place call. Please try again.');
      }
      setNoteInput('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error while calling.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelCall = async () => {
    if (!activeCall || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/calls/${activeCall.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      });
    } catch {
      setErrorMsg('Could not cancel request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            BeaconDesk
          </a>

          <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="text-slate-600 truncate max-w-[320px]">
              {snapshot.sessionTitle}
            </span>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleReplayTour}
              className="px-4 py-2 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              How It Works
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center">
        {/* Guided 2-Step Tour */}
        {!tourCompleted || !savedName ? (
          <div className="max-w-2xl mx-auto w-full">
            {/* Step Progress Line */}
            <div className="mb-6 flex items-center justify-between text-xs text-slate-500">
              <span>Participant Quick Tour</span>
              <span className="font-mono tabular-nums">
                Step {tourStep} of 2
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10">
              {tourStep === 1 ? (
                <form onSubmit={(e) => void handleSaveIdentity(e, false)} className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-blue-700">
                      01. Check In
                    </p>
                    <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                      Write your name to join the seminar desk
                    </h1>
                    <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                      Entering your name lets the facilitators see who is actively working in this session and know exactly who is calling if you ask for help.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="participant-name"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Your Name
                      </label>
                      <input
                        id="participant-name"
                        type="text"
                        required
                        autoFocus
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="e.g., Rohan Mehta"
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-base"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="participant-station"
                        className="block text-sm font-medium text-slate-700 mb-1.5"
                      >
                        Seat, Table, or Group <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <input
                        id="participant-station"
                        type="text"
                        value={stationInput}
                        onChange={(e) => setStationInput(e.target.value)}
                        placeholder="e.g., Table 3 or Front Row"
                        className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-sm"
                      />
                    </div>
                  </div>

                  {errorMsg && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                      {errorMsg}
                    </p>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-4">
                    <span className="text-xs text-slate-500">
                      No account or login needed
                    </span>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[48px] px-6 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {submitting ? 'Saving...' : 'Continue to Step 2'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-blue-700">
                      02. Calling for Help
                    </p>
                    <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                      Press one button whenever you have a question
                    </h1>
                    <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                      While you work through your tasks asynchronously, press the <strong className="font-semibold text-slate-900">Call a Facilitator</strong> button anytime you get stuck. All three facilitators receive an instant alert on their phones, and the first one available will come help and clear your call.
                    </p>
                  </div>

                  {/* Interactive visual illustration of the mechanism */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Participant: {savedName}</span>
                      <span>3 facilitators connected to dashboard</span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                      <div className="flex-1 rounded-xl bg-blue-700 text-white px-5 py-4 flex items-center justify-center gap-3 font-medium text-base select-none">
                        <BellRing className="w-5 h-5" />
                        Call a Facilitator
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-400 hidden sm:block shrink-0" />
                      <div className="flex-1 rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm text-slate-700 space-y-1">
                        <div className="font-medium text-slate-900">Instant Phone Alert</div>
                        <div className="text-xs text-slate-500">
                          Notifies all 3 facilitators · Shows when someone is on the way
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setTourStep(1)}
                      className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                    >
                      Back to Name
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleFinishTour()}
                      className="min-h-[48px] px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Got It — Open My Desk
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Main Participant Desk (Single Dominant Focal Anchor) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Primary Call Console */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 space-y-8">
              {/* Identity Strip */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{connected ? 'Connected live' : 'Reconnecting'}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {onlineFacilitatorCount > 0
                        ? `${onlineFacilitatorCount} facilitator${onlineFacilitatorCount === 1 ? '' : 's'} active`
                        : 'Facilitators notified via alerts'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="font-display text-2xl font-bold text-slate-900">
                      {savedName}
                    </h1>
                    {savedStation && (
                      <span className="text-sm text-slate-500">
                        · {savedStation}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(savedName);
                      setStationInput(savedStation);
                      setEditingProfile((v) => !v);
                    }}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Name
                  </button>
                  <button
                    type="button"
                    onClick={handleReplayTour}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer sm:hidden"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    Tour
                  </button>
                </div>
              </div>

              {/* Inline Name Edit Form */}
              {editingProfile && (
                <form
                  onSubmit={(e) => void handleSaveIdentity(e, true)}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      required
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="Your Name"
                      className="h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                    />
                    <input
                      type="text"
                      value={stationInput}
                      onChange={(e) => setStationInput(e.target.value)}
                      placeholder="Seat / Table (optional)"
                      className="h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="min-h-[40px] px-4 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[40px] px-4 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                    >
                      Save Details
                    </button>
                  </div>
                </form>
              )}

              {recentResolvedNotice && !activeCall && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start justify-between gap-3 text-sm text-emerald-900">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{recentResolvedNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecentResolvedNotice('')}
                    className="text-emerald-700 hover:text-emerald-900 p-1 cursor-pointer"
                    aria-label="Dismiss notice"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {snapshot.callsPaused && (
                <div
                  role="status"
                  className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3.5 flex items-start gap-3 text-sm text-amber-950"
                >
                  <PauseCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-semibold">
                      Calling is paused by the facilitator
                    </div>
                    <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
                      The facilitator has blocked calling at this point in time. You can continue your work and press the call button once calling is resumed.
                    </p>
                  </div>
                </div>
              )}

              {errorMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                  {errorMsg}
                </div>
              )}

              {/* Active Call State vs Ready State */}
              {!activeCall ? (
                <div className="space-y-5">
                  <div>
                    <label
                      htmlFor="question-note"
                      className="block text-sm font-medium text-slate-700 mb-2"
                    >
                      What do you need help with? <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      id="question-note"
                      rows={2}
                      maxLength={200}
                      disabled={snapshot.callsPaused}
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder={
                        snapshot.callsPaused
                          ? 'Calling is currently paused by the facilitator...'
                          : 'e.g., Quick question on Task 2, or just press the button below...'
                      }
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:opacity-60 text-sm resize-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCallFacilitator()}
                    disabled={submitting || snapshot.callsPaused}
                    className={`w-full min-h-[68px] px-6 py-4 rounded-2xl font-display font-semibold text-lg flex items-center justify-center gap-3 transition-all ${
                      snapshot.callsPaused
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-blue-700 hover:bg-blue-800 active:scale-[0.99] disabled:opacity-60 text-white cursor-pointer'
                    }`}
                  >
                    {snapshot.callsPaused ? (
                      <>
                        <PauseCircle className="w-6 h-6" />
                        Calling Paused by Facilitator
                      </>
                    ) : (
                      <>
                        <BellRing className="w-6 h-6" />
                        {submitting ? 'Sending Call...' : 'Call a Facilitator'}
                      </>
                    )}
                  </button>

                  <p className="text-xs text-slate-500 text-center">
                    Pressing this button notifies all three facilitators immediately. Keep this tab open to see when someone is on the way.
                  </p>
                </div>
              ) : (
                <div
                  className={`rounded-2xl border p-6 sm:p-8 space-y-6 ${
                    activeCall.status === 'claimed'
                      ? 'bg-blue-50/70 border-blue-200'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      {activeCall.status === 'claimed' ? (
                        <UserCheck className="w-5 h-5 text-blue-700" />
                      ) : (
                        <BellRing className="w-5 h-5 text-amber-700" />
                      )}
                      <span
                        className={`text-sm font-semibold ${
                          activeCall.status === 'claimed' ? 'text-blue-900' : 'text-amber-900'
                        }`}
                      >
                        {activeCall.status === 'claimed'
                          ? `${activeCall.claimedByFacilitatorName} is on the way`
                          : 'Calling facilitators now'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-sm font-mono tabular-nums text-slate-700">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span>{formatDuration(now - activeCall.createdAt)}</span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed">
                    {activeCall.status === 'claimed'
                      ? `${activeCall.claimedByFacilitatorName} has acknowledged your call and will clear this request once your question is resolved.`
                      : 'All three facilitators have received your notification. The first available facilitator will respond shortly.'}
                  </p>

                  {activeCall.note && (
                    <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <span className="text-xs text-slate-500 block mb-0.5">Your note</span>
                      {activeCall.note}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleCancelCall()}
                    disabled={submitting}
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-medium text-sm transition-colors cursor-pointer"
                  >
                    {activeCall.status === 'claimed'
                      ? 'My Question Was Answered — Cancel Call'
                      : 'Cancel Call Request'}
                  </button>
                </div>
              )}
            </div>

            {/* Right Column: Clear Instructions & Session Context */}
            <aside className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  How this seminar desk works
                </h2>
                <ol className="space-y-3 text-sm text-slate-600">
                  <li className="flex items-start gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-500 pt-0.5">01</span>
                    <span>
                      Keep working on your seminar tasks at your own pace. Your name stays listed as active for the facilitators.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-500 pt-0.5">02</span>
                    <span>
                      Whenever a question comes up, tap <strong className="font-medium text-slate-900">Call a Facilitator</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-500 pt-0.5">03</span>
                    <span>
                      Once a facilitator taps your call on their phone, you will see their name here and they will come help.
                    </span>
                  </li>
                </ol>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
};
