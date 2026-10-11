import type { PreparedMessageData } from '@common/types';
import type { Ui3nDialogComponentProps, Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';

export interface CreateMsgDialogProps {
  data: PreparedMessageData;
  isThisReplyOrForward?: boolean;
  dialogProps?: Ui3nDialogComponentProps<{ msgData: PreparedMessageData; withoutSave?: boolean }>;
}

export interface CreateMsgDialogEmits {
  (
    event: 'action',
    value: { event: Ui3nDialogEvent<'send' | 'update'>; data?: { msgData: PreparedMessageData; withoutSave?: boolean } },
  ): void;
}
