export const RECENT_FILE_NAME = 'recent' as const;

export const GROUPS_FILE_NAME = 'groups' as const;

export const IMAGES_FOLDER = 'images' as const;

export const DEFAULT_GROUP = {
  RECENT: 'recent',
  CARDS: 'cards',
  BANK_CARDS: 'bank_cards',
  FAVORITES: 'favorites',
} as const;

export const DEFAULT_GROUPS = [
  {
    id: '',
    icon: 'round-home',
    title: 'list.all',
  },
  {
    id: DEFAULT_GROUP.RECENT,
    icon: 'schedule',
    title: 'list.recent',
  },
  {
    id: DEFAULT_GROUP.CARDS,
    icon: 'cards-star-outline',
    title: 'list.cards',
  },
  {
    id: DEFAULT_GROUP.BANK_CARDS,
    icon: 'cards-star-outline',
    title: 'list.bank_cards',
  },
  {
    id: DEFAULT_GROUP.FAVORITES,
    icon: 'round-bookmark',
    title: 'list.favorites',
  },
] as const;

export const RECORD_TYPE = {
  PASSWORD: 'password',
  CARD: 'card',
  BANK_CARD: 'bank_card',
} as const;

export const RECORD_TYPES = [
  { id: RECORD_TYPE.PASSWORD, name: 'recordDialog.record_type.password' },
  { id: RECORD_TYPE.CARD, name: 'recordDialog.record_type.card' },
  { id: RECORD_TYPE.BANK_CARD, name: 'recordDialog.record_type.bank_card' },
];
