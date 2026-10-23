import type { Person } from '@main/types';

export const chatApp = Object.freeze({
  domain: 'chat.app.privacysafe.io',
  openCmd: 'open-chat-with',
});

export const inboxApp = Object.freeze({
  domain: 'inbox.app.privacysafe.io',
  openCmd: 'open-inbox-with',
});

export const NEW_EMPTY_CONTACT_ID = 'new';
export const NEW_POPULATED_CONTACT_ID = 'new-populated';
export function isNewContactId(id: string|undefined|null): boolean {
  return ((id === NEW_EMPTY_CONTACT_ID) || (id === NEW_POPULATED_CONTACT_ID));
}

export const EMPTY_CONTACT: Person = {
  id: NEW_EMPTY_CONTACT_ID,
  name: '',
  mail: '',
  avatarId: undefined,
  avatarImage: undefined,
  notice: '',
  phone: '',
  timestamp: 0,
};

export const TUTORIAL_DATA_KEY = 'tutorial-info' as string;
