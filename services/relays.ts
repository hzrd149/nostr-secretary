import { RelayPool } from "applesauce-relay";

export const pool = new RelayPool({
  enablePing: true,
  onUnresponsive: () => "reconnect",
});
