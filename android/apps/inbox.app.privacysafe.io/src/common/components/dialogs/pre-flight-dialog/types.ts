import type { Ui3nDialogComponentProps, Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';
import type { PreparedMessageData } from '@common/types';

export interface PreFlightDialogProps {
  msgData: PreparedMessageData;
  dialogProps?: Ui3nDialogComponentProps<Record<string, string>>;
}

export interface PreFlightDialogEmits {
  (event: 'action', value: { event: Ui3nDialogEvent; data?: Record<string, string> }): void;
}
