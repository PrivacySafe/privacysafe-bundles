export interface DialogResultMap {
  openFile: web3n.files.ReadonlyFile[];
  saveFile: web3n.files.WritableFile;
  openFolder: web3n.files.WritableFS[];
  saveFolder: web3n.files.WritableFS;
}

export type DialogMode = keyof DialogResultMap;
export type DialogResult = DialogResultMap[DialogMode] | undefined;

export interface DialogRequestState {
  mode: DialogMode | null;
  title: string;
  btnLabel: string;
  multiSelections: boolean;
  filters?: web3n.shell.files.FileTypeFilter[];
  defaultPath?: string;
  resolve: ((result: DialogResult) => void) | null;
  reject: ((error: unknown) => void) | null;
  /** set when the picker failed to start; a request arriving later is rejected with it */
  startupError?: unknown;
}
