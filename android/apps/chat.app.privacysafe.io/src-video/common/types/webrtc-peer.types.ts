export interface OffBandMessageJSON {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface OffBandMessage {
  description?: RTCSessionDescription;
  candidate?: RTCIceCandidateInit;
}

export interface OffBandSignalingChannel {
  observeIncoming(listener: (msg: OffBandMessage) => Promise<void>): void;
  send(msg: OffBandMessage): void;
  close(): void;
}
