/*
 Copyright (C) 2019 3NSoft Inc.

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
export default class CommonFs<T extends 'local' | 'synced'> {
  private fsI: web3n.files.WritableFS | undefined = undefined;
  public readonly id: number = 0;
  public readonly fsName: string = '';

  constructor(
    public name: string,
    public fsType: T,
  ) {
    this.fsName = name;
    this.fsType = fsType;
    this.id = Date.now();
  }

  public async getFs(): Promise<web3n.files.WritableFS | undefined> {
    if (!this.fsI) {
      await this.initFs();
    }
    return this.fsI;
  }

  public async initFs(): Promise<void> {
    if (this.fsName === undefined || this.fsName === null) {
      throw new Error('FS name is undefined!');
    }

    if (this.fsType === 'local') {
      this.fsI = await (w3n.storage as web3n.storage.Service).getAppLocalFS(this.fsName);
    } else {
      this.fsI = await (w3n.storage as web3n.storage.Service).getAppSyncedFS(this.fsName);
    }
  }
}
