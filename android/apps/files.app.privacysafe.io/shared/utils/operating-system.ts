export type OperatingSystem = 'macos' | 'linux' | 'windows';

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

/**
 * Maps the browser platform to the three values understood by the storage
 * service's getFolderContentFilledList() (it hides OS-specific folders).
 * Android and unknown platforms use the neutral Linux filtering branch.
 */
export function getOperatingSystem(): OperatingSystem {
  const nav = navigator as NavigatorWithUserAgentData;
  const platform = (nav.userAgentData?.platform || navigator.platform || '').toLowerCase();

  if (platform.includes('mac')) return 'macos';
  if (platform.includes('win')) return 'windows';
  return 'linux';
}
