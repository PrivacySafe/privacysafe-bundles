import type { WebRTCOffBandMessage } from '~/index.ts';

export type SignalsListener = (data: WebRTCOffBandMessage) => Promise<void>;
