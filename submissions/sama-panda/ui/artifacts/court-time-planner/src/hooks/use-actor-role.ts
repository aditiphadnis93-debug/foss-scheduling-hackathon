import { useSyncExternalStore } from "react";
import {
  getActorRole,
  subscribeActorRole,
  setActorRole,
  type ActorRole,
} from "@workspace/api-client-react";

export function useActorRole(): ActorRole {
  return useSyncExternalStore(subscribeActorRole, getActorRole, getActorRole);
}

export { setActorRole };
export type { ActorRole };
