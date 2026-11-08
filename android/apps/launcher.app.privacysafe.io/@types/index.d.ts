/// <reference path="./platform-defs/w3n.d.ts" />
/// <reference path="./platform-defs/system/system.d.ts" />

declare const w3n: web3n.caps.W3N & {
  system: web3n.system.SysUtils;
};
