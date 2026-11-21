export type FacilitatorSeatId = 'fac-1' | 'fac-2' | 'fac-3';

export type CallStatus = 'calling' | 'claimed' | 'resolved' | 'cancelled';

export interface Participant {
  id: string;
  name: string;
  station: string;
  online: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  totalCalls: number;
  tourCompleted: boolean;
}

export interface HelpCall {
  id: string;
  participantId: string;
  participantName: string;
  station: string;
  note: string;
  status: CallStatus;
  createdAt: number;
  claimedAt?: number;
  claimedByFacilitatorId?: string;
  claimedByFacilitatorName?: string;
  resolvedAt?: number;
  resolvedByFacilitatorName?: string;
}

export interface FacilitatorSeat {
  id: FacilitatorSeatId;
  name: string;
  online: boolean;
  alertsEnabled: boolean;
  lastSeenAt?: number;
}

export interface SessionSnapshot {
  sessionTitle: string;
  callsPaused: boolean;
  pausedByFacilitatorName?: string;
  participants: Participant[];
  calls: HelpCall[];
  facilitators: FacilitatorSeat[];
  serverTime: number;
}

export type WsClientMessage =
  | {
      type: 'hello';
      role: 'participant' | 'facilitator';
      id: string;
      name?: string;
      station?: string;
      alertsEnabled?: boolean;
    }
  | {
      type: 'ping';
    };

export type WsServerMessage =
  | {
      type: 'snapshot';
      snapshot: SessionSnapshot;
    }
  | {
      type: 'participant:updated';
      participant: Participant;
    }
  | {
      type: 'call:created';
      call: HelpCall;
    }
  | {
      type: 'call:updated';
      call: HelpCall;
    }
  | {
      type: 'facilitator:updated';
      facilitator: FacilitatorSeat;
    }
  | {
      type: 'session:updated';
      sessionTitle: string;
      callsPaused: boolean;
      pausedByFacilitatorName?: string;
    }
  | {
      type: 'pong';
      serverTime: number;
    };
