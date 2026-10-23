export interface AppMenuItem {
  id: string;
  name: string;
  icon?: string;
  routeName: string;
}

export const APP_MENU_DATA: AppMenuItem[] = [
  {
    id: '0',
    name: 'app.mobile.menu.my_apps',
    icon: 'round-apps',
    routeName: 'my-apps',
  },
  {
    id: '1',
    name: 'app.mobile.menu.updates',
    icon: 'deployed-code-update',
    routeName: 'updates',
  },
  {
    id: '2',
    name: 'app.mobile.menu.store',
    icon: 'app-store',
    routeName: 'app-store',
  },
  {
    id: '3',
    name: 'app.mobile.menu.settings',
    icon: 'outline-settings',
    routeName: 'settings',
  },
];
