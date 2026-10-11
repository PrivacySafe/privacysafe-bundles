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
export async function deleteLink({
  fs,
  path,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  stopErrorPropagate?: boolean;
}): Promise<void> {
  try {
    return fs.deleteLink(path);
  } catch (err) {
    console.log(
      `🔥 [deleteLink] Error deleting the link '${path}' . 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );
    if (!stopErrorPropagate) {
      throw err;
    }

    return;
  }
}
