import Squire from 'squire-rte';

export interface TextEditorProps {
  text?: string;
  autofocus?: boolean;
  showToolbar?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export interface TextEditorEmits {
  (event: 'init', value: Squire): void;
  (event: 'update:text', value: string): void,
}
