import {
  createAddressLoader,
  createEventLoader,
} from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { map } from "rxjs";

import config from "./config";

const lookupRelays = config.pipe(map((c) => c.lookupRelays));

export const pool = new RelayPool();

export const addressLoader = createAddressLoader(pool, { lookupRelays });
export const eventLoader = createEventLoader(pool);
