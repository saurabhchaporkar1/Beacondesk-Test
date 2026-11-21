import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  History,
  PauseCircle,
  Pencil,
  PlayCircle,
  QrCode,
  Search,
  Share2,
  Trash2,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { FacilitatorSeatId, HelpCall } from '../shared/types';
import { useRealtimeSession } from '../hooks/useRealtimeSession';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  dismissCallNotification,
  enableFacilitatorAlerts,
  getNotificationPermission,
  showCallNotification,
} from '../utils/notifications';
import { playCallChime, triggerDeviceVibration, unlockAudio } from '../utils/sound';
import { formatClockTime, formatDuration, formatRelativeTime } from '../utils/time';
import { QrCodeBox } from './QrCodeBox';

interface FacilitatorDashboardProps {
  onNavigateParticipant: () => void;
}

type DashboardTab = 'queue' | 'participants' | 'history' | 'share';
type ParticipantFilter = 'all' | 'online' | 'called';

const STORAGE_FACILITATOR_SEAT_KEY = 'beacondesk_facilitator_seat';
const STORAGE_SOUND_MUTED_KEY = 'beacondesk_sound_muted';

export const FacilitatorDashboard: React.FC<FacilitatorDashboardProps> = ({
  onNavigateParticipant,
}) => {
  const [selectedSeat, setSelectedSeat] = useState<FacilitatorSeatId>(() => {
    const saved = localStorage.getItem(STORAGE_FACILITATOR_SEAT_KEY);
    if (saved === 'fac-1' || saved === 'fac-2' || saved === 'fac-3') return saved;
    return 'fac-1';
  });

  const [activeTab, setActiveTab] = useState<DashboardTab>('queue');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    () => getNotificationPermission()
  );
  const [soundMuted, setSoundMuted] = useState<boolean>(
    () => localStorage.getItem(STORAGE_SOUND_MUTED_KEY) === 'true'
  );
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const [pushSubscribed, setPushSubscribed] = useState<boolean>(false);
  const [enablingAlerts, setEnablingAlerts] = useState<boolean>(false);

  const [editingSeatId, setEditingSeatId] = useState<FacilitatorSeatId | null>(null);
  const [seatNameDraft, setSeatNameDraft] = useState<string>('');
  const [participantSearch, setParticipantSearch] = useState<string>('');
  const [participantFilter, setParticipantFilter] = useState<ParticipantFilter>('all');

  const [copiedTarget, setCopiedTarget] = useState<'participant' | 'facilitator' | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState<string>('');
  const [savingTitle, setSavingTitle] = useState<boolean>(false);
  const [confirmReset, setConfirmReset] = useState<'history' | 'all' | null>(null);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>('');
  const [togglingPause, setTogglingPause] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;

  useEffect(() => {
    localStorage.setItem('beacondesk_role', 'facilitator');
  }, []);

  const alertsReady = notifPermission === 'granted';

  const realtimeIdentity = useMemo(
    () => ({
      role: 'facilitator' as const,
      id: selectedSeat,
      alertsEnabled: alertsReady || pushSubscribed,
    }),
    [selectedSeat, alertsReady, pushSubscribed]
  );

  const handleIncomingCall = useCallback((call: HelpCall) => {
    if (call.status !== 'calling') return;
    if (!soundMutedRef.current) {
      playCallChime();
    }
    triggerDeviceVibration();
    void showCallNotification(call);
  }, []);

  const handleCallUpdated = useCallback((call: HelpCall, prev?: HelpCall) => {
    // Whenever ANY facilitator claims, resolves, or participant cancels:
    // immediately close the OS notification on all facilitator devices!
    if (call.status !== 'calling' && prev?.status === 'calling') {
      void dismissCallNotification(call.id);
    }
    if (call.status === 'resolved' || call.status === 'cancelled') {
      void dismissCallNotification(call.id);
    }
  }, []);

  const { snapshot, connected, loading } = useRealtimeSession({
    identity: realtimeIdentity,
    onCallCreated: handleIncomingCall,
    onCallUpdated: handleCallUpdated,
  });

  useEffect(() => {
    if (!sessionTitleDraft && snapshot.sessionTitle) {
      setSessionTitleDraft(snapshot.sessionTitle);
    }
  }, [snapshot.sessionTitle, sessionTitleDraft]);

  // Live 1s timer tick for active call durations
  const activeCalls = useMemo(
    () =>
      snapshot.calls
        .filter((c) => c.status === 'calling' || c.status === 'claimed')
        .sort((a, b) => a.createdAt - b.createdAt),
    [snapshot.calls]
  );

  const unclaimedCalls = useMemo(
    () => activeCalls.filter((c) => c.status === 'calling'),
    [activeCalls]
  );

  const historyCalls = useMemo(
    () =>
      snapshot.calls
        .filter((c) => c.status === 'resolved' || c.status === 'cancelled')
        .sort((a, b) => (b.resolvedAt || b.createdAt) - (a.resolvedAt || a.createdAt)),
    [snapshot.calls]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Gentle periodic chime reminder every 12 seconds while an unclaimed call is still ringing
  useEffect(() => {
    if (unclaimedCalls.length === 0 || soundMuted) return;
    const reminder = window.setInterval(() => {
      if (!soundMutedRef.current) {
        playCallChime();
      }
    }, 12000);
    return () => clearInterval(reminder);
  }, [unclaimedCalls.length, soundMuted]);

  const currentFacilitator = useMemo(
    () =>
      snapshot.facilitators.find((f) => f.id === selectedSeat) || {
        id: selectedSeat,
        name: 'Facilitator',
        online: connected,
        alertsEnabled: alertsReady,
      },
    [snapshot.facilitators, selectedSeat, connected, alertsReady]
  );

  const onlineParticipantsCount = useMemo(
    () => snapshot.participants.filter((p) => p.online).length,
    [snapshot.participants]
  );

  const resolvedCallsCount = useMemo(
    () => snapshot.calls.filter((c) => c.status === 'resolved').length,
    [snapshot.calls]
  );

  const filteredParticipants = useMemo(() => {
    const q = participantSearch.trim().toLowerCase();
    return snapshot.participants.filter((p) => {
      if (participantFilter === 'online' && !p.online) return false;
      if (participantFilter === 'called' && p.totalCalls === 0) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.station.toLowerCase().includes(q)
      );
    });
  }, [snapshot.participants, participantSearch, participantFilter]);

  const participantUrl = useMemo(() => `${window.location.origin}/`, []);
  const facilitatorUrl = useMemo(() => `${window.location.origin}/dashboard`, []);

  const handleSelectSeat = (seatId: FacilitatorSeatId) => {
    setSelectedSeat(seatId);
    localStorage.setItem(STORAGE_FACILITATOR_SEAT_KEY, seatId);
  };

  const handleSaveSeatName = async (e: React.FormEvent, seatId: FacilitatorSeatId) => {
    e.preventDefault();
    const trimmed = seatNameDraft.trim();
    if (!trimmed) return;
    await fetch(`/api/facilitators/${seatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    setEditingSeatId(null);
  };

  const handleEnableAlerts = async () => {
    setEnablingAlerts(true);
    setStatusBanner('');
    try {
      const unlocked = await unlockAudio();
      setAudioUnlocked(unlocked);
      if (unlocked && !soundMuted) {
        playCallChime();
      }
      const res = await enableFacilitatorAlerts(selectedSeat);
      setNotifPermission(res.permission);
      setPushSubscribed(res.pushSubscribed);

      await fetch(`/api/facilitators/${selectedSeat}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertsEnabled: res.permission === 'granted' }),
      });

      if (res.permission === 'denied') {
        setStatusBanner(
          'Browser notifications are blocked in your phone or browser settings. In-page sound chimes and live alerts will still run while this page is open.'
        );
      } else if (res.permission === 'unsupported') {
        setStatusBanner(
          'System notifications are unavailable in this browser view. Keep this page open for live sound chimes, or add it to your Home Screen.'
        );
      } else {
        setStatusBanner('Phone alerts and sound chime are active on this device.');
      }
    } finally {
      setEnablingAlerts(false);
    }
  };

  const handleTestAlert = async () => {
    const unlocked = await unlockAudio();
    setAudioUnlocked(unlocked);
    if (!soundMuted) {
      playCallChime();
    }
    triggerDeviceVibration();

    if (notifPermission === 'granted') {
      await showCallNotification({
        id: `test-${Date.now()}`,
        participantId: 'test',
        participantName: 'Test Participant',
        station: 'Table 1',
        note: 'Testing facilitator phone notification',
        status: 'calling',
        createdAt: Date.now(),
      });
    }
    setStatusBanner('Test alert triggered on this device.');
  };

  const handleToggleMute = async () => {
    await unlockAudio();
    setSoundMuted((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_SOUND_MUTED_KEY, String(next));
      return next;
    });
  };

  const handleClaimCall = async (callId: string) => {
    await unlockAudio();
    await dismissCallNotification(callId);
    await fetch(`/api/calls/${callId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facilitatorId: selectedSeat,
        facilitatorName: currentFacilitator.name,
      }),
    });
  };

  const handleResolveCall = async (callId: string) => {
    await unlockAudio();
    await dismissCallNotification(callId);
    await fetch(`/api/calls/${callId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facilitatorId: selectedSeat,
        facilitatorName: currentFacilitator.name,
      }),
    });
  };

  const handleCopyUrl = async (target: 'participant' | 'facilitator') => {
    const url = target === 'participant' ? participantUrl : facilitatorUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 2200);
    } catch {
      setStatusBanner(`Copy link manually: ${url}`);
    }
  };

  const handleSaveSessionTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionTitleDraft.trim()) return;
    setSavingTitle(true);
    try {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionTitle: sessionTitleDraft.trim() }),
      });
      setStatusBanner('Session title updated across all devices.');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleClearSession = async (scope: 'history' | 'all') => {
    await fetch('/api/session/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    setConfirmReset(null);
    setStatusBanner(
      scope === 'all' ? 'All participants and call records cleared.' : 'Resolved call history cleared.'
    );
  };

  const handleTogglePauseCalling = async () => {
    setTogglingPause(true);
    try {
      const nextPaused = !snapshot.callsPaused;
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callsPaused: nextPaused,
          pausedByFacilitatorName: currentFacilitator.name,
        }),
      });
      setStatusBanner(
        nextPaused
          ? 'Participant calling is now paused. Participants see a notice that calling is blocked.'
          : 'Participant calling is now open again.'
      );
    } finally {
      setTogglingPause(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 sm:pb-8">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            BeaconDesk
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'queue'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Live Queue ({activeCalls.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('participants')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'participants'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Participants ({snapshot.participants.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'history'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              History ({historyCalls.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('share')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'share'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Share & QR
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyUrl('participant')}
              className="min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedTarget === 'participant' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Link Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Participant Link
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Session Title, Connection & Facilitator Seat Selector Strip */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  {connected ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-700" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-amber-700" />
                  )}
                  {connected ? 'Live sync active' : 'Reconnecting...'}
                </span>
                <span aria-hidden="true">·</span>
                <span>3-Facilitator Shared Console</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onNavigateParticipant}
                  className="text-blue-700 hover:underline font-medium cursor-pointer"
                >
                  Open Participant View
                </button>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                {snapshot.sessionTitle}
              </h1>
            </div>

            {/* Phone Alert & Audio Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleTogglePauseCalling()}
                disabled={togglingPause}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  snapshot.callsPaused
                    ? 'bg-red-700 text-white hover:bg-red-800'
                    : 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                }`}
              >
                {snapshot.callsPaused ? (
                  <>
                    <PlayCircle className="w-4 h-4" />
                    Resume Calling
                  </>
                ) : (
                  <>
                    <PauseCircle className="w-4 h-4" />
                    Pause Calling
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleEnableAlerts()}
                disabled={enablingAlerts}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  alertsReady
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                    : 'bg-blue-700 text-white hover:bg-blue-800'
                }`}
              >
                {alertsReady ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {enablingAlerts
                  ? 'Enabling...'
                  : alertsReady
                  ? 'Phone Alerts On'
                  : 'Enable Phone Alerts'}
              </button>

              <button
                type="button"
                onClick={() => void handleToggleMute()}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {soundMuted ? (
                  <>
                    <VolumeX className="w-4 h-4 text-slate-500" />
                    Muted
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 text-slate-700" />
                    Chime On
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleTestAlert()}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Test Alert
              </button>

              {!isInstalled && isInstallable && (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Install App
                </button>
              )}

              {!isInstalled && !isInstallable && isIOS && (
                <button
                  type="button"
                  onClick={() => setShowIOSInstallGuide(true)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Add to iPhone
                </button>
              )}
            </div>
          </div>

          {snapshot.callsPaused && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-red-900">
              <div className="flex items-center gap-2.5">
                <PauseCircle className="w-4 h-4 text-red-700 shrink-0" />
                <span>
                  <strong>Calling is paused</strong>
                  {snapshot.pausedByFacilitatorName ? ` by ${snapshot.pausedByFacilitatorName}` : ''}. Participants cannot send notifications and see a blocked banner.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleTogglePauseCalling()}
                disabled={togglingPause}
                className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Resume Calling
              </button>
            </div>
          )}

          {statusBanner && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-slate-700">
              <span>{statusBanner}</span>
              <button
                type="button"
                onClick={() => setStatusBanner('')}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                aria-label="Dismiss status message"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 3 Facilitator Seat Picker (No Login Required) */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-medium text-slate-600">
                Select your facilitator seat on this device (no login required):
              </span>
              <span className="text-xs text-slate-500">
                Active seat: <strong className="text-slate-900">{currentFacilitator.name}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {snapshot.facilitators.map((seat) => {
                const isSelected = seat.id === selectedSeat;
                const isEditing = editingSeatId === seat.id;

                return (
                  <div
                    key={seat.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(e) => void handleSaveSeatName(e, seat.id)}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={seatNameDraft}
                          onChange={(e) => setSeatNameDraft(e.target.value)}
                          autoFocus
                          className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                          placeholder="Facilitator name"
                        />
                        <button
                          type="submit"
                          className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-medium cursor-pointer"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectSeat(seat.id)}
                          className="flex-1 text-left min-h-[40px] flex flex-col justify-center cursor-pointer"
                        >
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {seat.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            {seat.online ? 'Connected now' : 'Standby'}
                            {seat.alertsEnabled ? ' · Alerts ready' : ''}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingSeatId(seat.id);
                            setSeatNameDraft(seat.name);
                          }}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                          aria-label={`Rename ${seat.name}`}
                          title="Rename facilitator"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4-Column KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
            <div className="text-xs text-slate-500">Calling Now</div>
            <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {activeCalls.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {unclaimedCalls.length} waiting for response
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
            <div className="text-xs text-slate-500">Online Participants</div>
            <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {onlineParticipantsCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Using website right now
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
            <div className="text-xs text-slate-500">Total Checked In</div>
            <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {snapshot.participants.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Have used website today
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
            <div className="text-xs text-slate-500">Resolved Queries</div>
            <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {resolvedCallsCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Completed this session
            </div>
          </div>
        </section>

        {/* Tab View Content */}
        {activeTab === 'queue' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Primary Active Calls Queue */}
            <section className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Incoming Help Requests
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">
                  {activeCalls.length === 0
                    ? 'Queue clear'
                    : `${activeCalls.length} active`}
                </span>
              </div>

              {loading ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="h-5 w-40 bg-slate-100 rounded" />
                  <div className="h-4 w-64 bg-slate-100 rounded" />
                </div>
              ) : activeCalls.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center space-y-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-700 mx-auto" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    No participants are calling right now
                  </h3>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    When a participant taps Call a Facilitator, their name appears here immediately and all three facilitators receive a phone alert.
                  </p>
                  {!audioUnlocked && !soundMuted && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => void handleEnableAlerts()}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                      >
                        Activate Alerts Before Seminar Starts
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {activeCalls.map((call) => {
                    const isUnclaimed = call.status === 'calling';
                    const waitMs = now - call.createdAt;
                    const isUrgent = isUnclaimed && waitMs > 120000;

                    return (
                      <article
                        key={call.id}
                        className={`rounded-2xl border p-5 sm:p-6 space-y-4 ${
                          isUnclaimed
                            ? isUrgent
                              ? 'bg-red-50/70 border-red-300'
                              : 'bg-amber-50/70 border-amber-300'
                            : 'bg-white border-blue-200'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs font-semibold">
                              {isUnclaimed ? (
                                <BellRing
                                  className={`w-4 h-4 ${
                                    isUrgent ? 'text-red-700' : 'text-amber-700'
                                  }`}
                                />
                              ) : (
                                <UserCheck className="w-4 h-4 text-blue-700" />
                              )}
                              <span
                                className={
                                  isUnclaimed
                                    ? isUrgent
                                      ? 'text-red-900'
                                      : 'text-amber-900'
                                    : 'text-blue-900'
                                }
                              >
                                {isUnclaimed
                                  ? 'Calling all facilitators'
                                  : `Claimed by ${call.claimedByFacilitatorName}`}
                              </span>
                            </div>

                            <h3 className="font-display text-xl font-bold text-slate-900">
                              {call.participantName}
                              {call.station && (
                                <span className="font-normal text-base text-slate-600">
                                  {' '}
                                  · {call.station}
                                </span>
                              )}
                            </h3>
                          </div>

                          <div className="flex items-center gap-1.5 text-sm font-mono font-medium tabular-nums text-slate-800">
                            <Clock className="w-4 h-4 text-slate-500" />
                            <span>{formatDuration(waitMs)}</span>
                          </div>
                        </div>

                        {call.note && (
                          <p className="text-sm text-slate-800 bg-white/90 border border-slate-200 rounded-xl px-4 py-2.5">
                            {call.note}
                          </p>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                          {isUnclaimed ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleClaimCall(call.id)}
                                className="flex-1 min-h-[48px] px-4 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                              >
                                <BellOff className="w-4 h-4" />
                                I&apos;m Going — Silence Alert
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleResolveCall(call.id)}
                                className="min-h-[48px] px-4 py-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Resolve Now
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleResolveCall(call.id)}
                              className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Mark Query Resolved
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Side-by-side Live Participant Presence on Desktop */}
            <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Session Participants
                  </h2>
                  <p className="text-xs text-slate-500">
                    {onlineParticipantsCount} online · {snapshot.participants.length} total
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('participants')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>

              {snapshot.participants.length === 0 ? (
                <div className="p-6 text-center space-y-2">
                  <Users className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-600">
                    No participants have entered their name yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('share')}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    Share Participant Link or QR Code
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
                  {snapshot.participants.slice(0, 12).map((p) => (
                    <li
                      key={p.id}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {p.name}
                          {p.station && (
                            <span className="text-slate-500 font-normal"> · {p.station}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 tabular-nums">
                          <span>{p.online ? 'Using website now' : `Left ${formatRelativeTime(p.lastSeenAt, now)}`}</span>
                          <span aria-hidden="true">·</span>
                          <span>{p.totalCalls} call{p.totalCalls === 1 ? '' : 's'}</span>
                        </div>
                      </div>

                      <span
                        className={`text-xs font-medium shrink-0 ${
                          p.online ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {p.online ? 'Online' : 'Offline'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}

        {/* Participants Roster Tab */}
        {activeTab === 'participants' && (
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Participant Roster
                </h2>
                <p className="text-xs text-slate-500">
                  Everyone who entered their name in the seminar tour and their current live status.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    placeholder="Search name or seat..."
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['all', 'online', 'called'] as ParticipantFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setParticipantFilter(f)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        participantFilter === f
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'online' ? 'Online Now' : 'Has Called'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredParticipants.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Users className="w-7 h-7 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-800">
                  No matching participants
                </p>
                <p className="text-xs text-slate-500">
                  Participants appear automatically as soon as they enter their name on Step 1 of the tour.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                      <th className="py-3 px-5">Participant</th>
                      <th className="py-3 px-4">Seat / Table</th>
                      <th className="py-3 px-4">Website Status</th>
                      <th className="py-3 px-4 text-right">Total Calls</th>
                      <th className="py-3 px-5 text-right">First Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredParticipants.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-3 px-5 font-medium text-slate-900">
                          {p.name}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {p.station || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-xs font-medium ${
                              p.online ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {p.online
                              ? 'Online now'
                              : `Offline · ${formatRelativeTime(p.lastSeenAt, now)}`}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                          {p.totalCalls}
                        </td>
                        <td className="py-3 px-5 text-right font-mono tabular-nums text-xs text-slate-500">
                          {formatClockTime(p.firstSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Call History Tab */}
        {activeTab === 'history' && (
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Resolved & Cancelled Call Log
                </h2>
                <p className="text-xs text-slate-500">
                  Complete record of seminar questions handled by your facilitator team.
                </p>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                {historyCalls.length} records
              </span>
            </div>

            {historyCalls.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <History className="w-7 h-7 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-800">
                  No resolved calls yet
                </p>
                <p className="text-xs text-slate-500">
                  Completed requests will appear here with response times and facilitator attribution.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                      <th className="py-3 px-5">Participant</th>
                      <th className="py-3 px-4">Note</th>
                      <th className="py-3 px-4">Outcome</th>
                      <th className="py-3 px-4">Handled By</th>
                      <th className="py-3 px-4 text-right">Duration</th>
                      <th className="py-3 px-5 text-right">Closed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {historyCalls.map((call) => {
                      const closedAt = call.resolvedAt || call.createdAt;
                      return (
                        <tr key={call.id} className="hover:bg-slate-50">
                          <td className="py-3 px-5 font-medium text-slate-900">
                            {call.participantName}
                            {call.station && (
                              <span className="text-slate-500 font-normal"> · {call.station}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                            {call.note || '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-medium ${
                                call.status === 'resolved' ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {call.status === 'resolved' ? 'Resolved' : 'Cancelled'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {call.resolvedByFacilitatorName ||
                              call.claimedByFacilitatorName ||
                              '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatDuration(closedAt - call.createdAt)}
                          </td>
                          <td className="py-3 px-5 text-right font-mono tabular-nums text-xs text-slate-500">
                            {formatClockTime(closedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Share Links, QR Codes & Session Settings Tab */}
        {activeTab === 'share' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Participant Share Card */}
              <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-blue-700">For Seminar Participants</p>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Participant Call Desk Link
                  </h2>
                  <p className="text-sm text-slate-600">
                    Share this link or display the QR code. Participants complete the 2-step tour (write name + see call button) with no login required.
                  </p>
                </div>

                <div className="flex justify-center py-2">
                  <QrCodeBox value={participantUrl} label="Participant Call Desk QR Code" />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={participantUrl}
                    className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl('participant')}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedTarget === 'participant' ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* Co-Facilitator Share Card */}
              <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-600">For Your 2 Co-Facilitators</p>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Facilitator Mobile Dashboard Link
                  </h2>
                  <p className="text-sm text-slate-600">
                    Send this link to the other two facilitators so they can open it on their phones, tap Enable Phone Alerts, and pick their seat.
                  </p>
                </div>

                <div className="flex justify-center py-2">
                  <QrCodeBox value={facilitatorUrl} label="Facilitator Dashboard QR Code" />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={facilitatorUrl}
                    className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl('facilitator')}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedTarget === 'facilitator' ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              </section>
            </div>

            {/* Session Controls */}
            <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <form
                onSubmit={(e) => void handleSaveSessionTitle(e)}
                className="flex flex-col sm:flex-row sm:items-end gap-3"
              >
                <div className="flex-1">
                  <label
                    htmlFor="session-title-input"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Seminar Session Title
                  </label>
                  <input
                    id="session-title-input"
                    type="text"
                    value={sessionTitleDraft}
                    onChange={(e) => setSessionTitleDraft(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingTitle}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {savingTitle ? 'Saving...' : 'Update Title'}
                </button>
              </form>

              <div className="pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Session Reset</h3>
                  <p className="text-xs text-slate-500">
                    Clear resolved logs or reset the entire room before starting a new seminar batch.
                  </p>
                </div>

                {confirmReset ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-700 font-medium">
                      {confirmReset === 'all'
                        ? 'Erase all participants & calls?'
                        : 'Clear resolved call log?'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleClearSession(confirmReset)}
                      className="min-h-[40px] px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(null)}
                      className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmReset('history')}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      Clear History
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset('all')}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-medium text-red-800 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Reset All Data
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Mobile Bottom Tab Bar (Thumb-zone navigation, <= 15% viewport height) */}
      <nav
        aria-label="Mobile dashboard navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200"
      >
        <div className="grid grid-cols-4 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              activeTab === 'queue' ? 'text-blue-700' : 'text-slate-500'
            }`}
          >
            <BellRing className="w-5 h-5" />
            <span>Queue ({activeCalls.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('participants')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              activeTab === 'participants' ? 'text-blue-700' : 'text-slate-500'
            }`}
          >
            <Users className="w-5 h-5" />
            <span>People ({snapshot.participants.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              activeTab === 'history' ? 'text-blue-700' : 'text-slate-500'
            }`}
          >
            <History className="w-5 h-5" />
            <span>History</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('share')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              activeTab === 'share' ? 'text-blue-700' : 'text-slate-500'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span>Share</span>
          </button>
        </div>
      </nav>

      {/* iOS Safari Add-to-Home-Screen Guide Modal */}
      {showIOSInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900">
                Install on iPhone / iPad
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSInstallGuide(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close guide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              iOS delivers website push alerts when the app is added to your Home Screen:
            </p>
            <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
              <li>Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Open <strong>BeaconDesk</strong> from your Home Screen and tap <strong>Enable Phone Alerts</strong>.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSInstallGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
