/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
interface GetListFolderBaseArgs {
  fs: web3n.files.FS;
  folderName: string;
  flags?: web3n.files.VersionedReadFlags;
  stopErrorPropagate?: boolean;
  actionIfError?: (err?: unknown) => void;
}

export async function getListFolder(
  args: GetListFolderBaseArgs & { vAPI: true },
): Promise<{ lst: web3n.files.ListingEntry[]; version: number } | undefined>;
export async function getListFolder(
  args: GetListFolderBaseArgs & { vAPI: false },
): Promise<web3n.files.ListingEntry[] | undefined>;
export async function getListFolder(args: GetListFolderBaseArgs & { vAPI: boolean | undefined }) {
  const { fs, folderName, vAPI, flags, stopErrorPropagate, actionIfError } = args;

  try {
    if (vAPI) {
      return fs.v?.listFolder(folderName, flags);
    }

    return await fs.listFolder(folderName);
  } catch (err) {
    console.log(
      `🔥 [getListFolder] Error getting list of the '${folderName}' folder contents. 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );

    actionIfError?.(err);

    if (!stopErrorPropagate) {
      throw err;
    }

    return undefined;
  }
}
