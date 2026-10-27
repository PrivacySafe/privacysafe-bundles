import { reactive, type InjectionKey } from 'vue';
import { sleep } from '@shared/utils/processes/sleep';
import type { DialogMode, DialogRequestState, DialogResult, DialogResultMap } from '@picker/common/types';
import { normalizeFilters, normalizeOptionalText, normalizeText } from '@picker/common/utils/request-params';

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
    reject: null,
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
  reject: (error: unknown) => void,
  opts: DialogRequestOpts,
) {
  if (dialogRequest.startupError !== undefined) {
    // the picker could not start: tell the caller instead of showing a broken dialog
    reject(dialogRequest.startupError);
    void closeAfterResolve();
    return;
  }

  // parameters come from another app: normalize them before the UI uses them
  dialogRequest.mode = mode;
  dialogRequest.title = normalizeText(opts.title);
  dialogRequest.btnLabel = normalizeText(opts.btnLabel);
  dialogRequest.multiSelections = opts.multiSelections === true;
  dialogRequest.filters = normalizeFilters(opts.filters);
  dialogRequest.defaultPath = normalizeOptionalText(opts.defaultPath);
  dialogRequest.resolve = resolve as DialogRequestState['resolve'];
  dialogRequest.reject = reject;
}

function createOpenFileHandler(dialogRequest: DialogRequestState): web3n.shell.files.OpenFileDialog {
  return (title, btnLabel, multiSelections, opts) =>
    new Promise<web3n.files.ReadonlyFile[] | undefined>((resolve, reject) => {
      beginDialogRequest(dialogRequest, 'openFile', resolve, reject, {
        title,
        btnLabel,
        multiSelections,
        filters: opts?.filters,
      });
    });
}

function createSaveFileHandler(dialogRequest: DialogRequestState): web3n.shell.files.SaveFileDialog {
  return (title, btnLabel, defaultPath, opts) =>
    new Promise<web3n.files.WritableFile | undefined>((resolve, reject) => {
      beginDialogRequest(dialogRequest, 'saveFile', resolve, reject, {
        title,
        btnLabel: btnLabel || '',
        defaultPath,
        filters: opts?.filters,
      });
    });
}

function createOpenFolderHandler(dialogRequest: DialogRequestState): web3n.shell.files.OpenFolderDialog {
  return (title, btnLabel, multiSelections, opts) =>
    new Promise<web3n.files.WritableFS[] | undefined>((resolve, reject) => {
      beginDialogRequest(dialogRequest, 'openFolder', resolve, reject, {
        title,
        btnLabel: btnLabel || '',
        multiSelections,
        filters: opts?.filters,
      });
    });
}

function createSaveFolderHandler(dialogRequest: DialogRequestState): web3n.shell.files.SaveFolderDialog {
  return (title, btnLabel, defaultPath, opts) =>
    new Promise<web3n.files.WritableFS | undefined>((resolve, reject) => {
      beginDialogRequest(dialogRequest, 'saveFolder', resolve, reject, {
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

  w3n.rpc!.provideCAPtoSystem!('w3n.shell.fileDialogs.openFolderDialog', createOpenFolderHandler(dialogRequest));

  w3n.rpc!.provideCAPtoSystem!('w3n.shell.fileDialogs.saveFolderDialog', createSaveFolderHandler(dialogRequest));
}

export function settleDialog(
  dialogRequest: DialogRequestState,
  result: DialogResult,
  { closeWindow = true }: { closeWindow?: boolean } = {},
) {
  const resolve = dialogRequest.resolve;
  dialogRequest.resolve = null;
  dialogRequest.reject = null;

  try {
    resolve?.(result);
  } catch (err) {
    console.error('🔥 ERROR RESOLVING DIALOG REQUEST. ', err);
  }

  if (closeWindow) {
    void closeAfterResolve();
  }
}

// a request may never come if the picker failed before it arrived
const CLOSE_WITHOUT_REQUEST_DELAY = 5000;

/**
 * Reports a failure of the picker itself (not a cancellation by the user) to
 * the caller, so that it can tell one from the other.
 */
export function failDialog(dialogRequest: DialogRequestState, error: unknown) {
  const reject = dialogRequest.reject;
  dialogRequest.resolve = null;
  dialogRequest.reject = null;

  if (reject) {
    reject(error);
    void closeAfterResolve();
    return;
  }

  dialogRequest.startupError = error ?? new Error('The file picker failed to start.');
  setTimeout(() => w3n.closeSelf!(), CLOSE_WITHOUT_REQUEST_DELAY);
}

async function closeAfterResolve(): Promise<void> {
  await sleep(0);
  w3n.closeSelf!();
}
