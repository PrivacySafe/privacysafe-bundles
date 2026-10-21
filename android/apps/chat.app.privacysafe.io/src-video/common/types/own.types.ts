import type { VideoShareStreamType } from './peer.types.ts';

export interface OwnVideoAudio {
  stream: MediaStream;
  deviceId: string;
}

export interface OwnScreen {
  stream: MediaStream;
  type: VideoShareStreamType;
  srcId: string;
  name: string;
}
