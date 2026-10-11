/*
 Copyright (C) 2025 3NSoft Inc.

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
import { resizeImage, schedulerYield, transformWeb3nFileToFile } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';

export async function createImageThumbnail(
  { file3n, fileId, incomingMsgId, targetSize = 200 }:
  {
    file3n?: web3n.files.ReadonlyFile,
    fileId?: string;
    incomingMsgId?: string;
    targetSize?: number;
    startTime?: number,
  },
): Promise<Nullable<string>> {
  const processedFile3n = file3n || await getFileByInfoFromMsg(fileId!, incomingMsgId);
  if (!processedFile3n) {
    return null;
  }
  await schedulerYield();

  const file = await transformWeb3nFileToFile(processedFile3n as web3n.files.ReadonlyFile);
  if (!file) {
    return null;
  }
  await schedulerYield();

  return resizeImage(file, targetSize);
}
