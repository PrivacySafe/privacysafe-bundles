export interface FsSEntityInfoProps {
  fsId: string;
  path: string;
}

export interface FsSEntityInfoEmits {
  (event: 'close'): void;
}
