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
export async function absorbRemoteFolderChanges({
  fs,
  path,
  opts,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToAdoptRemoteFolderChanges;
  stopErrorPropagate?: boolean;
}): Promise<number | undefined> {
  try {
    return fs.v?.sync?.absorbRemoteFolderChanges(path, opts);
  } catch (err) {
    console.log(
      `🔥 [absorbRemoteFolderChanges] Error in the process for the folder '${path}'. 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );
    if (!stopErrorPropagate) {
      throw err;
    }

    return undefined;
  }
}
