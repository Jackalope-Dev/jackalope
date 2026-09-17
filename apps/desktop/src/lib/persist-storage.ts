import { createJSONStorage, type StateStorage } from 'zustand/middleware';

export function createPersistStorage<T>() {
  const values = new Map<string, string>();
  const memory: StateStorage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
  const storage = () => (typeof window === 'undefined' ? undefined : window.localStorage) ?? memory;

  return createJSONStorage<T>(() => ({
    getItem: (name) => storage().getItem(name),
    setItem: (name, value) => storage().setItem(name, value),
    removeItem: (name) => storage().removeItem(name),
  }));
}
