export interface FsSEntityInfoProps {
  fsId: string;
  path: string;
  /** The root folder of the window the entity is shown in: tells what may be changed. */
  rootFolderId?: string;
}

export interface FsSEntityInfoEmits {
  (event: 'close'): void;
}
