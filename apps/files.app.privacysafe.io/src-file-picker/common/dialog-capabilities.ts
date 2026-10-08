import { reactive, type InjectionKey } from 'vue';
import { sleep } from '@shared/utils/processes/sleep';
import type { DialogMode, DialogRequestState, DialogResult, DialogResultMap } from '@picker/common/types';

export const DIALOG_REQUEST_KEY: InjectionKey<DialogRequestState> = Symbol('dialog-request');

export function createDialogRequestState(): DialogRequestState {
  return reactive({
    mode: null,
    title: '',
    btnLabel: '',
    multiSelections: false,
    filters: undefined,
    defaultPath: undefined,
    resolve: null,
  });
}

interface DialogRequestOpts {
  title: string;
  btnLabel: string;
  multiSelections?: boolean;
  filters?: web3n.shell.files.FileTypeFilter[];
  defaultPath?: string;
}

function beginDialogRequest<M extends DialogMode>(
  dialogRequest: DialogRequestState,
  mode: M,
  resolve: (result: DialogResultMap[M] | undefined) => void,
  opts: DialogRequestOpts,
) {
  dialogRequest.mode = mode;
  dialogRequest.title = opts.title;
  dialogRequest.btnLabel = opts.btnLabel;
  dialogRequest.multiSelections = opts.multiSelections ?? false;
  dialogRequest.filters = opts.filters;
  dialogRequest.defaultPath = opts.defaultPath;
  dialogRequest.resolve = resolve as DialogRequestState['resolve'];
}

function createOpenFileHandler(dialogRequest: DialogRequestState): web3n.shell.files.OpenFileDialog {
  return (title, btnLabel, multiSelections, opts) =>
    new Promise<web3n.files.ReadonlyFile[] | undefined>(resolve => {
      beginDialogRequest(dialogRequest, 'openFile', resolve, {
        title,
        btnLabel,
        multiSelections,
        filters: opts?.filters,
      });
    });
}

function createSaveFileHandler(dialogRequest: DialogRequestState): web3n.shell.files.SaveFileDialog {
  return (title, btnLabel, defaultPath, opts) =>
    new Promise<web3n.files.WritableFile | undefined>(resolve => {
      beginDialogRequest(dialogRequest, 'saveFile', resolve, {
        title,
        btnLabel: btnLabel || '',
        defaultPath,
        filters: opts?.filters,
      });
    });
}

export function registerDialogCapabilities(dialogRequest: DialogRequestState) {
  w3n.rpc!.provideCAPtoSystem!('w3n.shell.fileDialogs.openFileDialog', createOpenFileHandler(dialogRequest));
  w3n.rpc!.provideCAPtoSystem!('w3n.shell.fileDialogs.saveFileDialog', createSaveFileHandler(dialogRequest));
}

export function settleDialog(dialogRequest: DialogRequestState, result: DialogResult) {
  const resolve = dialogRequest.resolve;
  dialogRequest.resolve = null;

  try {
    resolve?.(result);
  } catch (err) {
    console.error('🔥 ERROR RESOLVING DIALOG REQUEST. ', err);
  }

  void closeAfterResolve();
}

async function closeAfterResolve(): Promise<void> {
  await sleep(0);
  w3n.closeSelf!();
}
