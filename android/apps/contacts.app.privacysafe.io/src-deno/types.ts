import type {
  AddressCheckResult,
  BackupValidationResult,
  ContactEvent,
  ContactsAppSettings,
  ImportedContact,
  Person,
  RawPerson,
  ShareChannel,
  TutorialState,
} from '../src/types/index.ts';
import type { BackupMetadataContent } from './utils/backup-archive.ts';

export interface ContactsDenoSrv {
  fs: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
  watchEvent: (obs: web3n.Observer<ContactEvent>) => () => void;
  watchContactBlacklistChanging: (obs: web3n.Observer<Person[]>) => () => void;
  watchContactListChanging: (obs: web3n.Observer<Person[]>) => () => void;

  addImage: ({
    base64,
    id,
    withUploadParentFolder,
  }: {
    base64: string;
    id?: string;
    withUploadParentFolder?: boolean;
  }) => Promise<string>;
  getImage: (id: string) => Promise<string>;
  deleteImage: (id: string, withoutUpload?: boolean) => Promise<void>;

  addContact: (
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ) => Promise<
    | Person
    | {
        errorType: string;
        errorMessage: string;
      }
  >;
  updateContact: (
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ) => Promise<Person>;
  upsertContact: (
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ) => Promise<
    | Person
    | {
        errorType: string;
        errorMessage: string;
      }
  >;
  changeContactBlockingSettings: ({
    id,
    mail,
    value,
  }: {
    id?: string;
    mail?: string;
    value: boolean;
  }) => Promise<Person>;
  deleteContact: (id: string, withoutParentUpload?: boolean) => Promise<void>;
  getContactList: (withImage?: boolean) => Promise<Person[]>;
  getContactBlacklist: (withImage?: boolean) => Promise<Person[]>;
  getContact: (id: string) => Promise<Person | undefined>;
  getContactByMail: (mail: string) => Promise<Person | undefined>;

  /** ASMail's answer on whether the address can receive, or undefined if unknown. */
  checkAddressReachability: (addr: string) => Promise<AddressCheckResult | undefined>;

  /**
   * Backup and restore. The archive bytes travel over ipc rather than being
   * written here, because the file dialogs are a gui capability: the deno
   * component is not granted shell.fileDialog, and does not need to be.
   */
  /**
   * With `forEncryption` the archive comes back without its metadata file: the
   * gui encrypts it and puts the metadata into the container around it.
   * `skippedImages` comes back too, since only this side knows what had to be
   * left out of the archive.
   */
  createBackupArchive: (opts?: {
    forEncryption?: boolean;
  }) => Promise<{ bytes: Uint8Array; skippedImages: string[] }>;
  cancelBackupArchive: () => Promise<boolean>;
  /**
   * Takes the archive already decrypted by the gui. An encrypted archive keeps
   * its metadata in the container outside, so the gui passes it in.
   */
  validateBackupArchive: (
    archiveBytes: Uint8Array,
    outerMetadata?: BackupMetadataContent,
  ) => Promise<BackupValidationResult>;
  restoreBackupArchive: (archiveBytes: Uint8Array) => Promise<boolean>;

  /**
   * Tutorial state persisted in the app's LOCAL fs, under `${key}.json`.
   * Returns undefined when nothing has been stored yet, so the caller applies
   * its own defaults.
   */
  getTutorialState: (key: string) => Promise<TutorialState | undefined>;
  saveTutorialState: (key: string, state: TutorialState) => Promise<void>;

  /**
   * Settings of the app on this device, in the app's LOCAL fs. A save merges
   * the given fields into the stored ones, resolves with the result and
   * broadcasts it as a 'settings' event to every window.
   */
  getAppSettings: () => Promise<ContactsAppSettings>;
  saveAppSettings: (patch: Partial<ContactsAppSettings>) => Promise<ContactsAppSettings>;

  /**
   * Sharing of contacts with another user. The export file is made here and
   * handed over to the chat or inbox app as an attachment of a message draft,
   * whose id the gui passes to that app in its start command.
   */
  checkChatWithPeer: (addr: string) => Promise<boolean>;
  shareContacts: (params: {
    contactIds: string[];
    recipient: string;
    channel: ShareChannel;
  }) => Promise<{ draftId: string }>;
  cancelShareContacts: () => Promise<boolean>;

  /**
   * Import of contacts shared by another user. Another app hands over the
   * file, and opens this app with the returned id in the 'import-contacts'
   * command; the window takes read contacts, which can be taken only once.
   */
  prepareSharedContactsImport: (
    file: web3n.files.ReadonlyFile,
  ) => Promise<{ importId: string; contactsCount: number }>;
  getSharedContactsImport: (importId: string) => Promise<ImportedContact[] | undefined>;
  finishSharedContactsImport: (importId: string) => Promise<void>;

  removeUnnecessaryImageFiles: () => Promise<void>;
  initialSyncProcess: () => Promise<void>;

  /**
   * Whether the storage server answered the latest request the service made to
   * it: 'unknown' before any. The same outcome is sent as server:reachability
   * events, but the first of them is sent during the service's start, before
   * any window can listen - so a window asks for it once it has connected.
   */
  getServerReachability: () => Promise<'unknown' | 'up' | 'down'>;
}

export type ContactsDenoSrvInternal = Omit<
  ContactsDenoSrv,
  'fs' | 'addContact' | 'updateContact' | 'getContactByMail'
>;

export type ContactsDenoSrvExternal = Pick<
  ContactsDenoSrv,
  | 'getContactByMail'
  | 'addContact'
  | 'upsertContact'
  | 'getContact'
  | 'getContactList'
  | 'getContactBlacklist'
  | 'changeContactBlockingSettings'
  | 'watchContactBlacklistChanging'
  | 'watchContactListChanging'
  | 'prepareSharedContactsImport'
>;
