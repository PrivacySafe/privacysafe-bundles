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
export async function saveFolder({
  fs,
  folder,
  dst,
  mergeAndOverwrite,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS;
  folder: web3n.files.FS;
  dst: string;
  mergeAndOverwrite?: boolean;
  stopErrorPropagate?: boolean;
}): Promise<void> {
  try {
    return fs.saveFolder(folder, dst, mergeAndOverwrite);
  } catch (err) {
    console.log(
      `🔥 [saveFolder] Error saving folder '${dst}' . 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );
    if (!stopErrorPropagate) {
      throw err;
    }

    return;
  }
}
