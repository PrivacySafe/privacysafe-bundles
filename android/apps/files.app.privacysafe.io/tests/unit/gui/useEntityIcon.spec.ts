import { createApp } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  dialogResult: { event: 'close' } as { event: string; data?: unknown },
  openDialog: vi.fn(),
  emit: vi.fn(),
  createNotice: vi.fn(),
  updateEntityXAttrs: vi.fn(async () => undefined),
  deleteEntityXAttrs: vi.fn(async () => undefined),
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@v1nt1248/3nclient-lib/plugins', () => ({
  DIALOGS_KEY: 'dialogs',
  NOTIFICATIONS_KEY: 'notifications',
  VUEBUS_KEY: 'bus',
}));
vi.mock('@/services/services-provider', () => ({
  appStorageSrv: {
    updateEntityXAttrs: env.updateEntityXAttrs,
    deleteEntityXAttrs: env.deleteEntityXAttrs,
  },
}));

const { useEntityIcon } = await import('../../../src/composables/useEntityIcon.ts');

const ICON = 'data:image/webp;base64,UklGRhIAAABXRUJQ';

function setup() {
  const app = createApp({});
  app.provide('dialogs', { $openDialog: env.openDialog });
  app.provide('notifications', { $createNotice: env.createNotice });
  app.provide('bus', { $emitter: { emit: env.emit } });
  return app.runWithContext(() => useEntityIcon());
}

beforeEach(() => {
  vi.clearAllMocks();
  env.openDialog.mockImplementation(async () => env.dialogResult);
});

describe('useEntityIcon', () => {
  it('writes a new icon into the entity and rereads its folder', async () => {
    env.dialogResult = { event: 'confirm', data: { icon: ICON } };
    const { editEntityIcon } = setup();

    const isChanged = await editEntityIcon({ fsId: 'user-synced', entity: { name: 'a.txt', fullPath: 'Docs/a.txt' } });

    expect(isChanged).toBe(true);
    expect(env.updateEntityXAttrs).toHaveBeenCalledWith({
      fsId: 'user-synced',
      path: 'Docs/a.txt',
      attrs: { icon: ICON },
    });
    expect(env.emit).toHaveBeenCalledWith('refresh:data', { path: 'Docs' });
  });

  it('opens the editor with the current icon and removes it on delete', async () => {
    env.dialogResult = { event: 'delete' };
    const { editEntityIcon } = setup();

    const isChanged = await editEntityIcon({
      fsId: 'user-synced',
      entity: { name: 'link', fullPath: 'link', icon: ICON },
    });

    expect(env.openDialog.mock.calls[0][1]).toMatchObject({ icon: ICON });
    expect(isChanged).toBe(true);
    expect(env.deleteEntityXAttrs).toHaveBeenCalledWith({ fsId: 'user-synced', path: 'link', attrNames: ['icon'] });
    expect(env.emit).toHaveBeenCalledWith('refresh:data', { path: '' });
  });

  it('changes nothing when the editor is closed', async () => {
    env.dialogResult = { event: 'cancel' };
    const { editEntityIcon } = setup();

    expect(await editEntityIcon({ fsId: 'user-synced', entity: { name: 'a', fullPath: 'a', icon: ICON } })).toBe(false);
    expect(env.updateEntityXAttrs).not.toHaveBeenCalled();
    expect(env.deleteEntityXAttrs).not.toHaveBeenCalled();
    expect(env.emit).not.toHaveBeenCalled();
  });

  it('reports a failed write and does not reread the folder', async () => {
    env.dialogResult = { event: 'confirm', data: { icon: ICON } };
    env.updateEntityXAttrs.mockRejectedValueOnce(new Error('no space'));
    const { editEntityIcon } = setup();

    expect(await editEntityIcon({ fsId: 'user-synced', entity: { name: 'a', fullPath: 'a' } })).toBe(false);
    expect(env.createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(env.emit).not.toHaveBeenCalled();
  });
});
