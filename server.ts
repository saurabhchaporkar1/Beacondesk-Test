import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import type webpushType from 'web-push';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof webpushType;
import type {
  FacilitatorSeat,
  FacilitatorSeatId,
  HelpCall,
  Participant,
  SessionSnapshot,
  WsClientMessage,
  WsServerMessage,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'beacondesk-state.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface StoredPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  facilitatorId?: string;
}

interface PersistedState {
  sessionTitle: string;
  callsPaused: boolean;
  pausedByFacilitatorName?: string;
  participants: Record<string, Participant>;
  calls: HelpCall[];
  facilitators: Record<FacilitatorSeatId, FacilitatorSeat>;
  pushSubscriptions: StoredPushSubscription[];
}

function defaultFacilitators(): Record<FacilitatorSeatId, FacilitatorSeat> {
  return {
    'fac-1': {
      id: 'fac-1',
      name: 'Facilitator 1',
      online: false,
      alertsEnabled: false,
    },
    'fac-2': {
      id: 'fac-2',
      name: 'Facilitator 2',
      online: false,
      alertsEnabled: false,
    },
    'fac-3': {
      id: 'fac-3',
      name: 'Facilitator 3',
      online: false,
      alertsEnabled: false,
    },
  };
}

function loadState(): PersistedState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const participants: Record<string, Participant> = {};
      if (parsed.participants) {
        for (const [id, p] of Object.entries(parsed.participants)) {
          participants[id] = { ...p, online: false };
        }
      }
      const facilitators = defaultFacilitators();
      if (parsed.facilitators) {
        (['fac-1', 'fac-2', 'fac-3'] as FacilitatorSeatId[]).forEach((fid) => {
          if (parsed.facilitators?.[fid]) {
            facilitators[fid] = { ...parsed.facilitators[fid], online: false };
          }
        });
      }
      return {
        sessionTitle: parsed.sessionTitle || 'Seminar Workshop Session',
        callsPaused: Boolean(parsed.callsPaused),
        pausedByFacilitatorName: parsed.pausedByFacilitatorName,
        participants,
        calls: Array.isArray(parsed.calls) ? parsed.calls : [],
        facilitators,
        pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions : [],
      };
    }
  } catch (err) {
    console.error('Failed to load persisted state, starting fresh:', err);
  }
  return {
    sessionTitle: 'Seminar Workshop Session',
    callsPaused: false,
    participants: {},
    calls: [],
    facilitators: defaultFacilitators(),
    pushSubscriptions: [],
  };
}

const state: PersistedState = loadState();

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmpFile = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (err) {
      console.error('Failed to persist state:', err);
    }
  }, 100);
}

// Configure Web Push VAPID keys
function loadOrCreateVapid(): { publicKey: string; privateKey: string } {
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const data = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8')) as {
        publicKey: string;
        privateKey: string;
      };
      if (data.publicKey && data.privateKey) return data;
    }
  } catch {
    // Regenerate below
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  return keys;
}

const vapidKeys = loadOrCreateVapid();
webpush.setVapidDetails('mailto:facilitator@beacondesk.local', vapidKeys.publicKey, vapidKeys.privateKey);

// Track active WebSocket connections
interface ClientConn {
  ws: WebSocket;
  role?: 'participant' | 'facilitator';
  id?: string;
}

const activeClients = new Set<ClientConn>();

function recomputeOnlineFlags() {
  const onlineParticipants = new Set<string>();
  const onlineFacilitators = new Set<string>();

  for (const client of activeClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.role === 'participant' && client.id) {
      onlineParticipants.add(client.id);
    }
    if (client.role === 'facilitator' && client.id) {
      onlineFacilitators.add(client.id);
    }
  }

  for (const p of Object.values(state.participants)) {
    p.online = onlineParticipants.has(p.id);
  }
  for (const f of Object.values(state.facilitators)) {
    f.online = onlineFacilitators.has(f.id);
  }
}

function getSnapshot(): SessionSnapshot {
  recomputeOnlineFlags();
  return {
    sessionTitle: state.sessionTitle,
    callsPaused: state.callsPaused,
    pausedByFacilitatorName: state.pausedByFacilitatorName,
    participants: Object.values(state.participants).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.lastSeenAt - a.lastSeenAt;
    }),
    calls: [...state.calls].sort((a, b) => b.createdAt - a.createdAt),
    facilitators: [
      state.facilitators['fac-1'],
      state.facilitators['fac-2'],
      state.facilitators['fac-3'],
    ],
    serverTime: Date.now(),
  };
}

function broadcast(message: WsServerMessage) {
  const raw = JSON.stringify(message);
  for (const client of activeClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

async function sendWebPushToFacilitators(payload: Record<string, unknown>) {
  if (state.pushSubscriptions.length === 0) return;
  const body = JSON.stringify(payload);
  const expiredEndpoints = new Set<string>();

  await Promise.all(
    state.pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ?? null,
            keys: sub.keys,
          },
          body
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.size > 0) {
    state.pushSubscriptions = state.pushSubscriptions.filter(
      (s) => !expiredEndpoints.has(s.endpoint)
    );
    scheduleSave();
  }
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // API Routes
  app.get('/api/snapshot', (_req, res) => {
    res.json(getSnapshot());
  });

  app.post('/api/participants/register', (req, res) => {
    const { id, name, station, tourCompleted } = req.body as {
      id?: string;
      name?: string;
      station?: string;
      tourCompleted?: boolean;
    };

    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      res.status(400).json({ error: 'Name is required.' });
      return;
    }

    const participantId = (id || '').trim() || crypto.randomUUID();
    const now = Date.now();
    const existing = state.participants[participantId];

    const participant: Participant = {
      id: participantId,
      name: trimmedName.slice(0, 60),
      station: (station || '').trim().slice(0, 40),
      online: existing?.online ?? true,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      totalCalls: existing?.totalCalls ?? 0,
      tourCompleted: tourCompleted ?? existing?.tourCompleted ?? false,
    };

    state.participants[participantId] = participant;
    recomputeOnlineFlags();
    scheduleSave();
    broadcast({ type: 'participant:updated', participant: state.participants[participantId] });
    res.json({ participant: state.participants[participantId] });
  });

  app.post('/api/calls', (req, res) => {
    const { participantId, participantName, station, note } = req.body as {
      participantId?: string;
      participantName?: string;
      station?: string;
      note?: string;
    };

    const pid = (participantId || '').trim();
    const pname = (participantName || '').trim();
    if (!pid || !pname) {
      res.status(400).json({ error: 'Participant ID and name are required.' });
      return;
    }

    if (state.callsPaused) {
      res.status(403).json({
        error: 'The facilitator has paused calling at this point in time.',
      });
      return;
    }

    // Check if an active call already exists for this participant (idempotent guard)
    const existingActive = state.calls.find(
      (c) => c.participantId === pid && (c.status === 'calling' || c.status === 'claimed')
    );
    if (existingActive) {
      res.json({ call: existingActive });
      return;
    }

    const now = Date.now();
    if (!state.participants[pid]) {
      state.participants[pid] = {
        id: pid,
        name: pname.slice(0, 60),
        station: (station || '').trim().slice(0, 40),
        online: true,
        firstSeenAt: now,
        lastSeenAt: now,
        totalCalls: 1,
        tourCompleted: true,
      };
    } else {
      state.participants[pid].name = pname.slice(0, 60);
      if (typeof station === 'string') {
        state.participants[pid].station = station.trim().slice(0, 40);
      }
      state.participants[pid].lastSeenAt = now;
      state.participants[pid].totalCalls += 1;
    }

    const newCall: HelpCall = {
      id: crypto.randomUUID(),
      participantId: pid,
      participantName: state.participants[pid].name,
      station: state.participants[pid].station,
      note: (note || '').trim().slice(0, 200),
      status: 'calling',
      createdAt: now,
    };

    state.calls.unshift(newCall);
    scheduleSave();
    broadcast({ type: 'participant:updated', participant: state.participants[pid] });
    broadcast({ type: 'call:created', call: newCall });

    const locationPart = newCall.station ? ` (${newCall.station})` : '';
    const notePart = newCall.note ? ` — "${newCall.note}"` : '';
    void sendWebPushToFacilitators({
      type: 'call:created',
      callId: newCall.id,
      title: `${newCall.participantName}${locationPart} is calling`,
      body: `Needs facilitator assistance${notePart}. Tap to respond.`,
    });

    res.status(201).json({ call: newCall });
  });

  app.post('/api/calls/:id/claim', (req, res) => {
    const callId = req.params.id;
    const { facilitatorId, facilitatorName } = req.body as {
      facilitatorId?: string;
      facilitatorName?: string;
    };

    const call = state.calls.find((c) => c.id === callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found.' });
      return;
    }

    if (call.status === 'calling') {
      call.status = 'claimed';
      call.claimedAt = Date.now();
      call.claimedByFacilitatorId = facilitatorId || 'fac-1';
      call.claimedByFacilitatorName = (facilitatorName || 'A facilitator').trim().slice(0, 50);
      scheduleSave();
      broadcast({ type: 'call:updated', call });
      void sendWebPushToFacilitators({ type: 'call:dismiss', callId: call.id });
    }

    res.json({ call });
  });

  app.post('/api/calls/:id/resolve', (req, res) => {
    const callId = req.params.id;
    const { facilitatorName } = req.body as { facilitatorName?: string };

    const call = state.calls.find((c) => c.id === callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found.' });
      return;
    }

    if (call.status === 'calling' || call.status === 'claimed') {
      call.status = 'resolved';
      call.resolvedAt = Date.now();
      call.resolvedByFacilitatorName =
        (facilitatorName || call.claimedByFacilitatorName || 'Facilitator').trim().slice(0, 50);
      scheduleSave();
      broadcast({ type: 'call:updated', call });
      void sendWebPushToFacilitators({ type: 'call:dismiss', callId: call.id });
    }

    res.json({ call });
  });

  app.post('/api/calls/:id/cancel', (req, res) => {
    const callId = req.params.id;
    const call = state.calls.find((c) => c.id === callId);
    if (!call) {
      res.status(404).json({ error: 'Call not found.' });
      return;
    }

    if (call.status === 'calling' || call.status === 'claimed') {
      call.status = 'cancelled';
      call.resolvedAt = Date.now();
      scheduleSave();
      broadcast({ type: 'call:updated', call });
      void sendWebPushToFacilitators({ type: 'call:dismiss', callId: call.id });
    }

    res.json({ call });
  });

  app.patch('/api/facilitators/:id', (req, res) => {
    const fid = req.params.id as FacilitatorSeatId;
    if (!state.facilitators[fid]) {
      res.status(404).json({ error: 'Facilitator seat not found.' });
      return;
    }

    const { name, alertsEnabled } = req.body as {
      name?: string;
      alertsEnabled?: boolean;
    };

    if (typeof name === 'string' && name.trim()) {
      state.facilitators[fid].name = name.trim().slice(0, 40);
    }
    if (typeof alertsEnabled === 'boolean') {
      state.facilitators[fid].alertsEnabled = alertsEnabled;
    }
    state.facilitators[fid].lastSeenAt = Date.now();

    recomputeOnlineFlags();
    scheduleSave();
    broadcast({ type: 'facilitator:updated', facilitator: state.facilitators[fid] });
    res.json({ facilitator: state.facilitators[fid] });
  });

  app.patch('/api/session', (req, res) => {
    const { sessionTitle, callsPaused, pausedByFacilitatorName } = req.body as {
      sessionTitle?: string;
      callsPaused?: boolean;
      pausedByFacilitatorName?: string;
    };
    let changed = false;
    if (typeof sessionTitle === 'string' && sessionTitle.trim()) {
      state.sessionTitle = sessionTitle.trim().slice(0, 80);
      changed = true;
    }
    if (typeof callsPaused === 'boolean') {
      state.callsPaused = callsPaused;
      state.pausedByFacilitatorName = callsPaused
        ? (pausedByFacilitatorName || 'A facilitator').trim().slice(0, 50)
        : undefined;
      changed = true;
    }
    if (changed) {
      scheduleSave();
      broadcast({
        type: 'session:updated',
        sessionTitle: state.sessionTitle,
        callsPaused: state.callsPaused,
        pausedByFacilitatorName: state.pausedByFacilitatorName,
      });
    }
    res.json({
      sessionTitle: state.sessionTitle,
      callsPaused: state.callsPaused,
      pausedByFacilitatorName: state.pausedByFacilitatorName,
    });
  });

  app.post('/api/session/clear', (req, res) => {
    const { scope } = req.body as { scope?: 'history' | 'all' };
    if (scope === 'all') {
      state.calls = [];
      state.participants = {};
    } else {
      state.calls = state.calls.filter((c) => c.status === 'calling' || c.status === 'claimed');
    }
    scheduleSave();
    broadcast({ type: 'snapshot', snapshot: getSnapshot() });
    res.json({ ok: true });
  });

  // Web Push endpoints
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const { subscription, facilitatorId } = req.body as {
      subscription?: StoredPushSubscription;
      facilitatorId?: FacilitatorSeatId;
    };

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).json({ error: 'Invalid push subscription.' });
      return;
    }

    const idx = state.pushSubscriptions.findIndex((s) => s.endpoint === subscription.endpoint);
    const entry: StoredPushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: subscription.keys,
      facilitatorId,
    };

    if (idx >= 0) {
      state.pushSubscriptions[idx] = entry;
    } else {
      state.pushSubscriptions.push(entry);
    }

    if (facilitatorId && state.facilitators[facilitatorId]) {
      state.facilitators[facilitatorId].alertsEnabled = true;
      broadcast({ type: 'facilitator:updated', facilitator: state.facilitators[facilitatorId] });
    }

    scheduleSave();
    res.json({ ok: true, count: state.pushSubscriptions.length });
  });

  app.post('/api/push/test', async (_req, res) => {
    await sendWebPushToFacilitators({
      type: 'test',
      title: 'BeaconDesk Alert Test',
      body: 'Phone notifications are connected for your seminar session.',
    });
    res.json({ ok: true });
  });

  // Serve Vite or production dist
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const conn: ClientConn = { ws };
    activeClients.add(conn);

    // Send initial snapshot immediately
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: getSnapshot() } satisfies WsServerMessage));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() } satisfies WsServerMessage));
          return;
        }
        if (msg.type === 'hello') {
          conn.role = msg.role;
          conn.id = msg.id;

          if (msg.role === 'participant' && msg.id && msg.name) {
            const now = Date.now();
            const existing = state.participants[msg.id];
            state.participants[msg.id] = {
              id: msg.id,
              name: msg.name.trim().slice(0, 60),
              station: (msg.station ?? existing?.station ?? '').trim().slice(0, 40),
              online: true,
              firstSeenAt: existing?.firstSeenAt ?? now,
              lastSeenAt: now,
              totalCalls: existing?.totalCalls ?? 0,
              tourCompleted: existing?.tourCompleted ?? true,
            };
            scheduleSave();
            recomputeOnlineFlags();
            broadcast({
              type: 'participant:updated',
              participant: state.participants[msg.id],
            });
          } else if (msg.role === 'facilitator' && msg.id) {
            const fid = msg.id as FacilitatorSeatId;
            if (state.facilitators[fid]) {
              state.facilitators[fid].lastSeenAt = Date.now();
              if (typeof msg.alertsEnabled === 'boolean') {
                state.facilitators[fid].alertsEnabled = msg.alertsEnabled;
              }
              recomputeOnlineFlags();
              scheduleSave();
              broadcast({
                type: 'facilitator:updated',
                facilitator: state.facilitators[fid],
              });
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      const prevRole = conn.role;
      const prevId = conn.id;
      activeClients.delete(conn);
      recomputeOnlineFlags();

      if (prevRole === 'participant' && prevId && state.participants[prevId]) {
        state.participants[prevId].lastSeenAt = Date.now();
        scheduleSave();
        broadcast({ type: 'participant:updated', participant: state.participants[prevId] });
      } else if (prevRole === 'facilitator' && prevId && state.facilitators[prevId as FacilitatorSeatId]) {
        const fid = prevId as FacilitatorSeatId;
        state.facilitators[fid].lastSeenAt = Date.now();
        scheduleSave();
        broadcast({ type: 'facilitator:updated', facilitator: state.facilitators[fid] });
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BeaconDesk server running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start BeaconDesk server:', err);
  process.exit(1);
});
