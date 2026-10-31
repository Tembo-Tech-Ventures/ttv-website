import { useEffect, useSyncExternalStore } from "react";
import type { SpacesController } from "../spaces";

/** Create the controller once (useState/useMemo); fixture harnesses can use spaces.mock.ts. */
export function useSpaces(controller: SpacesController) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getServerSnapshot);
  useEffect(() => { controller.hydratePreference(); }, [controller]);
  return { ...state, switchSpace: controller.switchSpace, dispatchDrawer: controller.dispatchDrawer,
    handleDrawerKey: controller.handleDrawerKey };
}
