export const styleByStatus: Record<
  web3n.files.SyncState | 'remote',
  { icon: string; iconColor: string; color: string }
> = {
  unsynced: {
    icon: 'round-info',
    iconColor: 'var(--color-icon-control-secondary-default)',
    color: 'var(--color-text-control-secondary-default)',
  },
  synced: {
    icon: 'round-check-circle',
    iconColor: 'var(--success-content-default)',
    color: 'var(--success-content-default)',
  },
  behind: {
    icon: 'round-warning',
    iconColor: 'var(--color-icon-control-warning-default)',
    color: 'var(--color-text-control-warning-default)',
  },
  conflicting: {
    icon: 'round-info',
    iconColor: 'var(--error-content-default)',
    color: 'var(--error-content-default)',
  },
  remote: {
    icon: 'cloud-off-rounded',
    iconColor: 'var(--color-icon-control-primary-default)',
    color: 'var(--color-text-control-primary-default)',
  },
};
