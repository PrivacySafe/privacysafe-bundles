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
import { resizeImage, schedulerYield, sleep } from '@v1nt1248/3nclient-lib/utils';
import { appContactsSrvProxy } from '@main/common/services/services-provider';

/**
 * Stores an avatar the way the contact page does: the image of 104px under a
 * new id, and the one of 40px for lists under `<id>-mini`.
 */
export async function saveContactAvatar(image: string | File | Blob): Promise<{ avatarId: string; mini: string }> {
  const imageMain = await resizeImage(image, 104);
  await schedulerYield();
  const imageMini = await resizeImage(image, 40);
  await schedulerYield();
  const avatarId = await appContactsSrvProxy.addImage({ base64: imageMain });
  await sleep(10);
  await appContactsSrvProxy.addImage({
    base64: imageMini,
    id: `${avatarId}-mini`,
    withUploadParentFolder: true,
  });
  return { avatarId, mini: imageMini };
}
