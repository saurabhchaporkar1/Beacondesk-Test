import { useEffect, useRef, useState } from 'react';
import type {
  FacilitatorSeat,
  HelpCall,
  Participant,
  SessionSnapshot,
  WsClientMessage,
  WsServerMessage,
} from '../shared/types';

export interface RealtimeHelloIdentity {
  role: 'participant' | 'facilitator';
  id: string;
  name?: string;
  station?: string;
  alertsEnabled?: boolean;
}

interface UseRealtimeOptions {
  identity: RealtimeHelloIdentity | null;
  onCallCreated?: (call: HelpCall) => void;
  onCallUpdated?: (call: HelpCall, previous?: HelpCall) => void;
}

export function useRealtimeSession({
  identity,
  onCallCreated,
  onCallUpdated,
}: UseRealtimeOptions) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    sessionTitle: 'Seminar Workshop Session',
    callsPaused: false,
    participants: [],
    calls: [],
    facilitators: [
      { id: 'fac-1', name: 'Facilitator 1', online: false, alertsEnabled: false },
      { id: 'fac-2', name: 'Facilitator 2', online: false, alertsEnabled: false },
      { id: 'fac-3', name: 'Facilitator 3', online: false, alertsEnabled: false },
    ],
    serverTime: Date.now(),
  });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const identityRef = useRef(identity);
  const onCallCreatedRef = useRef(onCallCreated);
  const onCallUpdatedRef = useRef(onCallUpdated);
  const callsMapRef = useRef<Map<string, HelpCall>>(new Map());

  identityRef.current = identity;
  onCallCreatedRef.current = onCallCreated;
  onCallUpdatedRef.current = onCallUpdated;

  // Send updated hello whenever identity changes while connected
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && identity) {
      const msg: WsClientMessage = {
        type: 'hello',
        role: identity.role,
        id: identity.id,
        name: identity.name,
        station: identity.station,
        alertsEnabled: identity.alertsEnabled,
      };
      ws.send(JSON.stringify(msg));
    }
  }, [
    identity?.role,
    identity?.id,
    identity?.name,
    identity?.station,
    identity?.alertsEnabled,
  ]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let retryDelay = 800;

    // Initial HTTP snapshot fetch for fast hydration
    fetch('/api/snapshot')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionSnapshot | null) => {
        if (!disposed && data) {
          const map = new Map<string, HelpCall>();
          data.calls.forEach((c) => map.set(c.id, c));
          callsMapRef.current = map;
          setSnapshot(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!disposed) setLoading(false);
      });

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        setConnected(true);
        setLoading(false);
        retryDelay = 800;

        const currentIdentity = identityRef.current;
        if (currentIdentity) {
          const hello: WsClientMessage = {
            type: 'hello',
            role: currentIdentity.role,
            id: currentIdentity.id,
            name: currentIdentity.name,
            station: currentIdentity.station,
            alertsEnabled: currentIdentity.alertsEnabled,
          };
          ws.send(JSON.stringify(hello));
        }

        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' } satisfies WsClientMessage));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WsServerMessage;
          if (msg.type === 'snapshot') {
            const map = new Map<string, HelpCall>();
            msg.snapshot.calls.forEach((c) => map.set(c.id, c));
            callsMapRef.current = map;
            setSnapshot(msg.snapshot);
            return;
          }

          if (msg.type === 'participant:updated') {
            setSnapshot((prev) => {
              const idx = prev.participants.findIndex((p) => p.id === msg.participant.id);
              const nextList: Participant[] =
                idx >= 0
                  ? prev.participants.map((p) => (p.id === msg.participant.id ? msg.participant : p))
                  : [msg.participant, ...prev.participants];
              nextList.sort((a, b) => {
                if (a.online !== b.online) return a.online ? -1 : 1;
                return b.lastSeenAt - a.lastSeenAt;
              });
              return { ...prev, participants: nextList };
            });
            return;
          }

          if (msg.type === 'call:created') {
            const alreadyExists = callsMapRef.current.has(msg.call.id);
            callsMapRef.current.set(msg.call.id, msg.call);
            setSnapshot((prev) => {
              if (prev.calls.some((c) => c.id === msg.call.id)) return prev;
              return { ...prev, calls: [msg.call, ...prev.calls] };
            });
            if (!alreadyExists) {
              onCallCreatedRef.current?.(msg.call);
            }
            return;
          }

          if (msg.type === 'call:updated') {
            const previous = callsMapRef.current.get(msg.call.id);
            callsMapRef.current.set(msg.call.id, msg.call);
            setSnapshot((prev) => {
              const exists = prev.calls.some((c) => c.id === msg.call.id);
              const nextCalls = exists
                ? prev.calls.map((c) => (c.id === msg.call.id ? msg.call : c))
                : [msg.call, ...prev.calls];
              return { ...prev, calls: nextCalls };
            });
            onCallUpdatedRef.current?.(msg.call, previous);
            return;
          }

          if (msg.type === 'facilitator:updated') {
            setSnapshot((prev) => ({
              ...prev,
              facilitators: prev.facilitators.map((f): FacilitatorSeat =>
                f.id === msg.facilitator.id ? msg.facilitator : f
              ),
            }));
            return;
          }

          if (msg.type === 'session:updated') {
            setSnapshot((prev) => ({
              ...prev,
              sessionTitle: msg.sessionTitle,
              callsPaused: msg.callsPaused,
              pausedByFacilitatorName: msg.pausedByFacilitatorName,
            }));
          }
        } catch {
          // Ignore malformed WS payloads
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.6, 8000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { snapshot, connected, loading };
}
