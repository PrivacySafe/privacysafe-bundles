import type { FavoriteFolder } from '@shared/types';

export interface FavoriteListItemProps {
  item: FavoriteFolder & { folderName?: string };
}

export interface FavoriteListItemEmits {
  (event: 'go', value: FavoriteFolder & { folderName?: string }): void;
}
