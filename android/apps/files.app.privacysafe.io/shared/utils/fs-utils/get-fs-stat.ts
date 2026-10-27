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
export async function getFsStat({
  fs,
  path,
  vAPI,
  flags,
  stopErrorPropagate,
}: {
  fs: web3n.files.FS;
  path: string;
  vAPI?: boolean,
  flags?: web3n.files.VersionedReadFlags;
  stopErrorPropagate?: boolean;
}): Promise<web3n.files.Stats | undefined> {
  try {
    return vAPI
      ? await fs.v?.stat(path, flags)
      : await fs.stat(path);
  } catch (err) {
    console.log(
      `🔥 [getFsStat] Error in the process for the FS object '${path}'. 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );
    if (!stopErrorPropagate) {
      throw err;
    }

    return undefined;
  }
}
