export type AppStatus = 'stable' | 'beta' | 'nightly';

function isAppStatus(tag: string): tag is AppStatus {
  return tag === 'stable' || tag === 'beta' || tag === 'nightly';
}

export function getAppStatus(tags: readonly string[] = []): AppStatus | undefined {
  const statuses = [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(isAppStatus))];

  if (statuses.length !== 1) {
    return;
  }

  return statuses[0];
}

export function getAppTags(tags: readonly string[] = []): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(tag => tag && !isAppStatus(tag.toLowerCase())))];
}
