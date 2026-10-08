import type {
  AddressCheckResult,
  BackupValidationResult,
  ContactEvent,
  Person,
  RawPerson,
  TutorialState,
} from '../src/types/index.ts';
import type { BackupMetadataContent } from './utils/backup-archive.ts';

export interface ContactsDenoSrv {
  fs: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
  watchEvent: (obs: web3n.Observer<ContactEvent>) => () => void;
  watchContactBlacklistChanging: (obs: web3n.Observer<Person[]>) => () => void;

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

  removeUnnecessaryImageFiles: () => Promise<void>;
  initialSyncProcess: () => Promise<void>;
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
>;
