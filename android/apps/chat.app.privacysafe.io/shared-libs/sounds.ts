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

export class Sound {

  private readonly audio: HTMLAudioElement;

  private constructor(blobUrl: string) {
    this.audio = new Audio(blobUrl);
    Object.seal(this);
  }

  private static registry = new FinalizationRegistry(
    (url: string) => URL.revokeObjectURL(url)
  );

  static async from(url: string): Promise<Sound> {
    // We have a work/run around of bytes into Blob, as it removes error,
    // currently produced by client platform's session implementation.
    const blob = await (await fetch(url)).blob();
    const blobUrl = URL.createObjectURL(blob);
    const s = new Sound(blobUrl);
    Sound.registry.register(s, blobUrl);
    return s;
  }

  playOnce(): Promise<void> {
    this.audio.loop = false;
    return this.audio.play();
  }

  playInLoop(): Promise<void> {
    this.audio.loop = true;
    return this.audio.play();
  }

  setVolume(volume: number): void {
    this.audio.volume = volume;
  }

  stop(): void {
    this.audio.pause();
    this.audio.load();
  }

  pause(): void {
    this.audio.pause();
  }
}
