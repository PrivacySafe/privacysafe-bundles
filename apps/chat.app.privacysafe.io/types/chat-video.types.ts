export interface PeerVideo {
  peerAddr: string;
  peerName: string;
  videoMuted: boolean;
  audioMuted: boolean;
  vaStream?: MediaStream;
  isReconnecting: boolean;
}
