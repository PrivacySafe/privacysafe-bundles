import type { ChatMessageAttachmentsInfo } from '~/chat.types';

export interface AttachmentViewInfo extends ChatMessageAttachmentsInfo{
  filename: string;
  ext: string;
  isActionAvailable?: boolean;
}
