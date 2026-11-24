import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SidebarFolder {
  id: string;
  name: string;
}

interface SidebarState {
  /** Tiles at the top of the sidebar, in pin order: `project:<id>` or `work:<work id>`. */
  favorites: string[];
  /** Work items (by work id) kept above their project's other work. */
  pinnedWork: string[];
  /** Each project's folders, in creation order. */
  folders: Record<string, SidebarFolder[]>;
  /** The folder a work item was moved into; absent work sits in the project's list. */
  placement: Record<string, string>;
  /** Folders folded in the sidebar; absent folders are open. */
  collapsedFolders: Record<string, boolean>;
  /** The folder whose name is being edited in place; not saved. */
  renaming: string | null;
  setRenaming: (folderId: string | null) => void;
  toggleFavorite: (key: string) => void;
  togglePinnedWork: (workId: string) => void;
  addFolder: (projectId: string, name: string) => string;
  renameFolder: (projectId: string, folderId: string, name: string) => void;
  /** Removes the folder; its work goes back to the project's list. */
  removeFolder: (projectId: string, folderId: string) => void;
  /** Moves work into a folder, or out of any folder with `null`. */
  place: (workId: string, folderId: string | null) => void;
  toggleFolder: (folderId: string) => void;
}

const toggled = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      favorites: [],
      pinnedWork: [],
      folders: {},
      placement: {},
      collapsedFolders: {},
      renaming: null,
      setRenaming: (renaming) => set({ renaming }),
      toggleFavorite: (key) => set((state) => ({ favorites: toggled(state.favorites, key) })),
      togglePinnedWork: (workId) =>
        set((state) => ({ pinnedWork: toggled(state.pinnedWork, workId) })),
      addFolder: (projectId, name) => {
        const id = `folder-${crypto.randomUUID()}`;
        set((state) => ({
          folders: {
            ...state.folders,
            [projectId]: [...(state.folders[projectId] ?? []), { id, name }],
          },
        }));
        return id;
      },
      renameFolder: (projectId, folderId, name) =>
        set((state) => ({
          folders: {
            ...state.folders,
            [projectId]: (state.folders[projectId] ?? []).map((folder) =>
              folder.id === folderId ? { ...folder, name } : folder,
            ),
          },
        })),
      removeFolder: (projectId, folderId) =>
        set((state) => {
          const { [folderId]: _, ...collapsedFolders } = state.collapsedFolders;
          return {
            folders: {
              ...state.folders,
              [projectId]: (state.folders[projectId] ?? []).filter(
                (folder) => folder.id !== folderId,
              ),
            },
            placement: Object.fromEntries(
              Object.entries(state.placement).filter(([, folder]) => folder !== folderId),
            ),
            collapsedFolders,
          };
        }),
      place: (workId, folderId) =>
        set((state) => {
          const placement = { ...state.placement };
          if (folderId) placement[workId] = folderId;
          else delete placement[workId];
          return { placement };
        }),
      toggleFolder: (folderId) =>
        set((state) => {
          const collapsedFolders = { ...state.collapsedFolders };
          if (collapsedFolders[folderId]) delete collapsedFolders[folderId];
          else collapsedFolders[folderId] = true;
          return { collapsedFolders };
        }),
    }),
    {
      name: 'jackalope-sidebar',
      partialize: ({ favorites, pinnedWork, folders, placement, collapsedFolders }) => ({
        favorites,
        pinnedWork,
        folders,
        placement,
        collapsedFolders,
      }),
    },
  ),
);
