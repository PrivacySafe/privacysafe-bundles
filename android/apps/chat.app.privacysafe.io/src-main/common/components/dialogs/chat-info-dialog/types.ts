import type { ChatListItemView } from '~/chat.types.ts';
import type { Ui3nDialogComponentProps } from '@v1nt1248/3nclient-lib';

export interface ChatInfoDialogProps {
  chat: ChatListItemView;
  isMobileMode?: boolean;
  dialogProps?: Ui3nDialogComponentProps<void>;
}
