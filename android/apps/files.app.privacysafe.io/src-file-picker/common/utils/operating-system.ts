export type PickerOperatingSystem = 'macos' | 'linux' | 'windows';

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

/**
 * Maps the browser platform to the three values understood by
 * AppStorageInternal.getFolderContentFilledList(). Android and unknown
 * platforms use the service's neutral Linux filtering branch.
 */
export function getPickerOperatingSystem(): PickerOperatingSystem {
  const nav = navigator as NavigatorWithUserAgentData;
  const platform = (nav.userAgentData?.platform || navigator.platform || '').toLowerCase();

  if (platform.includes('mac')) return 'macos';
  if (platform.includes('win')) return 'windows';
  return 'linux';
}
