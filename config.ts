import { BehaviorSubject, map, Observable, skip } from "rxjs";
import fs from "fs/promises";
import { DEFAULT_LOOKUP_RELAYS } from "./const";

export type AppConfig = {
  /** The hex pubkey of the user */
  user?: string;
  /** An array of relays to use when looking up profiles and mailboxes */
  lookupRelays: string[];
};

const config = new BehaviorSubject<AppConfig>({
  lookupRelays: DEFAULT_LOOKUP_RELAYS,
});

const CONFIG_PATH = Bun.env.CONFIG ?? "config.json";

// Read config file if set from env
if (await fs.exists(CONFIG_PATH))
  config.next(JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8")));

// Save config when it changes
config.pipe(skip(1)).subscribe((config) => {
  fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
});

/** Create an observable that gets a config value */
export function configValue<K extends keyof AppConfig>(key: K): Observable<AppConfig[K]> {
  return config.pipe(map((c) => c[key]));
}

export default config;
