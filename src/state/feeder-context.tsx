import {
  createContext,
  type PropsWithChildren,
  useContext,
  useSyncExternalStore,
} from "react";
import { FeederStore, type FeederSnapshot } from "./feeder-store";

export const defaultFeederStore = new FeederStore();

const FeederStoreContext = createContext<FeederStore>(defaultFeederStore);

export function FeederStoreProvider({
  store = defaultFeederStore,
  children,
}: PropsWithChildren<{ store?: FeederStore }>) {
  return <FeederStoreContext.Provider value={store}>{children}</FeederStoreContext.Provider>;
}

export function useFeederStore(): FeederStore {
  return useContext(FeederStoreContext);
}

export function useFeederSnapshot(): FeederSnapshot {
  const store = useFeederStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
