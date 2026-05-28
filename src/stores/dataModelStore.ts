import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { DataModel } from "../schemas";

interface DataModelState {
  model: DataModel;
  setModel: (model: DataModel) => void;
}

export const useDataModelStore = create<DataModelState>()(
  persist(
    (set) => ({
      model: "simple",
      setModel: (model) => set({ model }),
    }),
    {
      name: "powersync-bench-data-model",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
