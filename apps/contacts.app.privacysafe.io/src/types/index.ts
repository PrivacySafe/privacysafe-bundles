export * from './common-app.ts';
export * from './contacts-service.ts';

import type { Person } from './contacts-service.ts';

export interface AppGlobalEvents {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  'contact-list:updated': void;
}

export type ContactContent = Omit<Person, 'id'|'avatar'|'avatarMini'|'activities'|'timestamp'>;

/**
 * Contact fields the contact form edits as plain text. `ContactContent` also
 * carries non-text fields (`settings`, `avatarId`), and typing the form's field
 * events as `keyof ContactContent` let a string be written into any of them.
 */
export type ContactTextField = 'mail' | 'name' | 'phone' | 'notice';

export interface OpenChatCmdArg {
  peerAddress: string;
}

export interface OpenInboxCmdArg {
  peerAddress: string;
}


