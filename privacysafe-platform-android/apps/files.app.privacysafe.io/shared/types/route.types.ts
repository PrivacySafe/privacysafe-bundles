export interface RouteSingle {
  name: 'single';
  params: {
    rootFolderId: string;
  };
  query: {
    view?: 'table' | 'tile';
    path: string;
    activeWindow?: '1';
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };
}

export interface RouteDouble {
  name: 'double';
  params: {
    rootFolderId: string;
    rootFolder2Id: string;
  };
  query: {
    view?: 'table' | 'tile';
    path: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    path2: string;
    sort2By?: string;
    sort2Order?: 'asc' | 'desc';
    activeWindow: '1' | '2';
  };
}
