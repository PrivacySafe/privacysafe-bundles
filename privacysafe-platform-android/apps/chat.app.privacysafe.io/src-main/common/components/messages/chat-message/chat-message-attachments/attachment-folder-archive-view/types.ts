export interface EntityListItem {
  name: string;
  isFile?: boolean;
  isFolder?: boolean;
  isLink?: boolean;
  children?: EntityListItem[];
}
