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
/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
import { copyFsEntity } from './copy-fs-entity.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

export async function copyFsEntities({
  srcFs,
  entities,
  targetFs,
  targetFolder,
}: {
  srcFs: web3n.files.WritableFS;
  entities: ListingEntryExtended[];
  targetFs: web3n.files.WritableFS;
  targetFolder: string;
}): Promise<PromiseSettledResult<string | undefined>[]> {
  const promisesRes = [];
  for (const entity of entities) {
    promisesRes.push(copyFsEntity({ srcFs, entity, targetFs, targetFolder }));
  }
  return Promise.allSettled(promisesRes);
}
