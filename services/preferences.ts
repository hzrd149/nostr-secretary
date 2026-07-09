import { mapEventsToStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import type { EventTemplate } from "applesauce-core/helpers/event";
import {
  getAppDataContent,
  unlockAppData,
} from "applesauce-common/helpers/app-data";
import { onlyEvents } from "applesauce-relay";
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  firstValueFrom,
  map,
  NEVER,
  of,
  ReplaySubject,
  share,
  skip,
  switchMap,
  timeout,
  timer,
  type MonoTypeOperatorFunction,
} from "rxjs";
import { eventStore, mailboxes$, pool, signer$, user$ } from "./nostr";
import config$, { getConfig, updateConfig } from "./config";
import { log } from "./logs";
import {
  isNewerPrefs,
  mergePrefs,
  PREFS_KIND,
  PREFS_NAMESPACE,
  sanitizeSyncedPrefs,
  serializePrefs,
} from "../helpers/preferences";

/** Local copy of services/nostr.ts's private shareAndHold helper (not exported there). */
function shareAndHold<T>(cacheTime = 60_000): MonoTypeOperatorFunction<T> {
  return share({
    resetOnRefCountZero: () => timer(cacheTime),
    connector: () => new ReplaySubject(1),
  });
}

/**
 * D2-09 loop-prevention marker: the JSON of the last `SyncedPrefs` payload we
 * know is already published to (or was just applied from) nostr. Set after a
 * successful publish AND after applying a remote update, so that the
 * publish pipeline can no-op when `config$` re-emits an echo of what's
 * already on the relay -- never a raw `skip(N)` counter (Pitfall 5).
 */
let lastKnownPayloadJSON: string | null = null;

/**
 * D2-08 high-water-mark: the `created_at` of the newest remote preferences
 * event already applied to `config$`. An inbound event is only applied when
 * strictly newer than this value (never on equal/older/replayed events).
 */
let lastAppliedCreatedAt = 0;

/**
 * Wraps a signer round-trip promise in a hard timeout. `NostrConnectSigner`
 * has no built-in timeout (Pitfall 3) -- an unsupported/unresponsive bunker
 * call can hang forever, freezing this service's pipelines. Rejects with an
 * Error after `ms` milliseconds if `promise` hasn't settled.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

/**
 * D2-12 sync-active signal: true only when a signer is connected (regardless
 * of config content). Readable by the UI (no-signer hint) and /status.
 */
export const enabled$ = combineLatest([config$, signer$]).pipe(
  map(([, signer]) => Boolean(signer)),
  distinctUntilChanged(),
  shareAndHold(),
);

/**
 * Reactive value of the user's own kind-30078 notification-prefs event, if
 * any (mirrors `groups$`). Always passes `identifier: PREFS_NAMESPACE` --
 * 30078 is parameterized-replaceable, and omitting the d-tag risks matching
 * an unrelated 30078 app-data event for the same pubkey (Pitfall 2).
 */
export const preferencesEvent$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user]) =>
    user
      ? eventStore.replaceable({
          kind: PREFS_KIND,
          pubkey: user,
          identifier: PREFS_NAMESPACE,
        })
      : EMPTY,
  ),
  shareAndHold(),
);

/**
 * Builds, self-encrypts (NIP-44), signs, and publishes the current local
 * notification preferences as a kind-30078 event to the user's outbox
 * relays (D2-01/D2-02/D2-03/D2-10). No-ops (local-only) when no signer is
 * connected. Never throws -- a failure (timeout, rejection, publish error)
 * is caught and logged; the local `config.json` save already happened via
 * the existing `config.ts:126` subscription and is never lost (D2-15).
 */
async function publishPreferences(): Promise<void> {
  const signer = signer$.value;
  if (!signer) return; // D2-12: no signer -- stay local-only. (signer.nip44 is never
  // undefined for the wired NostrConnectAccount -- D2-14 correction, do not gate on it)

  try {
    const ownPubkey = await withTimeout(
      signer.getPublicKey(),
      8000,
      "getPublicKey",
    );

    const payload = serializePrefs(getConfig());
    const plaintext = JSON.stringify(payload);

    // `signer.nip44` is typed optional (bunker capability, not a client-side
    // guarantee) but is never actually undefined for the wired
    // NostrConnectAccount (D2-14 correction). This narrows for the compiler
    // only -- it is not a behavioral gate; if it were ever undefined, the
    // throw is caught below and degrades to local-only + log (D2-15), same
    // as any other signer round-trip failure.
    const nip44 = signer.nip44;
    if (!nip44) throw new Error("Signer does not support nip44 encryption");

    // NIP-44 self-encrypt to the user's OWN pubkey (D2-02).
    const ciphertext = await withTimeout(
      nip44.encrypt(ownPubkey, plaintext),
      8000,
      "nip44.encrypt",
    );

    const template: EventTemplate = {
      kind: PREFS_KIND,
      created_at: unixNow(),
      tags: [["d", PREFS_NAMESPACE]],
      content: ciphertext,
    };

    const signed = await withTimeout(
      signer.signEvent(template),
      8000,
      "signEvent",
    );

    // D2-10/Pitfall 7: outbox relays, falling back to lookupRelays if empty/undefined.
    const mailboxes = await firstValueFrom(
      mailboxes$.pipe(timeout({ first: 3000, with: () => of(undefined) })),
    );
    const relays = mailboxes?.outboxes?.length
      ? mailboxes.outboxes
      : getConfig().lookupRelays;

    await pool.publish(relays, signed);

    // Record what is now on nostr so a subsequent echo doesn't republish (D2-09).
    lastKnownPayloadJSON = plaintext;

    // Log summary fields only -- never the plaintext/ciphertext (Information Disclosure mitigation).
    log("Published notification preferences", { created_at: signed.created_at });
  } catch (error) {
    log("Failed to publish notification preferences", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// D2-07: debounced publish pipeline. skip(1) suppresses only the boot-time
// emission (same convention as config.ts:126) -- it is NOT the
// loop-prevention mechanism. Loop prevention is the payload-equality check
// against lastKnownPayloadJSON below (D2-09, Pitfall 5 -- do not use a
// skip(N) counter or an applyingRemote timing flag).
config$
  .pipe(
    skip(1),
    map(serializePrefs),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    debounceTime(1500),
  )
  .subscribe((payload) => {
    const json = JSON.stringify(payload);
    if (json === lastKnownPayloadJSON) return; // D2-09: echo of what we already have on nostr
    void publishPreferences();
  });

// D2-11: live REQ so remote edits (another device, or a third-party
// interoperating app) arrive promptly, feeding eventStore -- which
// preferencesEvent$ reacts to. Mirrors tagged$'s pool.subscription shape.
combineLatest([user$, mailboxes$])
  .pipe(
    switchMap(([user, mailboxes]) => {
      if (!user) return NEVER;
      const relays = mailboxes?.outboxes?.length
        ? mailboxes.outboxes
        : getConfig().lookupRelays;
      return pool
        .subscription(
          relays,
          { kinds: [PREFS_KIND], authors: [user], "#d": [PREFS_NAMESPACE] },
          { reconnect: Infinity, resubscribe: true },
        )
        .pipe(onlyEvents(), mapEventsToStore(eventStore));
    }),
  )
  .subscribe();

// D2-08/D2-09/D2-11: decrypt-and-apply pipeline, mirrors mutedPubkeys$'s
// decrypt-in-switchMap(async) pattern. authors:[user] (above) plus
// eventStore.replaceable's pubkey scoping (preferencesEvent$) is the
// authorship guard -- only the user's own pubkey's events are considered
// (Tampering mitigation, T-02-08).
combineLatest([preferencesEvent$, signer$])
  .pipe(
    switchMap(async ([event, signer]) => {
      if (!event || !signer) return;
      // D2-08 high-water-mark gate BEFORE the expensive decrypt.
      if (!isNewerPrefs(event.created_at, lastAppliedCreatedAt)) return;

      try {
        await withTimeout(unlockAppData(event, signer), 8000, "unlockAppData");
        const raw = getAppDataContent<unknown>(event);
        const sanitized = sanitizeSyncedPrefs(raw);
        if (!sanitized) {
          log("Ignoring malformed remote notification preferences", {
            created_at: event.created_at,
          });
          return;
        }

        lastAppliedCreatedAt = event.created_at;
        const merged = mergePrefs(getConfig(), sanitized);
        // D2-09: set BEFORE updateConfig so the config$ echo this triggers
        // no-ops the publish pipeline (Pattern 5 ordering).
        lastKnownPayloadJSON = JSON.stringify(serializePrefs(merged));
        updateConfig(merged);

        // Log summary fields only -- never the decrypted payload (Information Disclosure mitigation).
        log("Applied remote notification preferences", {
          created_at: event.created_at,
        });
      } catch (error) {
        log("Failed to decrypt/apply remote notification preferences", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  )
  .subscribe();
