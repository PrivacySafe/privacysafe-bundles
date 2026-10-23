export interface FolderListItem {
  name: string;
  type: 'file' | 'folder' | 'link';
  size?: number;
  mtime?: Date;
  diversity?: boolean;
  children?: FolderListItem[];
}
