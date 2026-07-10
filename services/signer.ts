import { NostrConnectAccount } from "applesauce-accounts/accounts";
import { NostrConnectSigner, PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject } from "rxjs";
import { DEFAULT_SIGNER_RELAYS, SIGNER_PERMISSIONS } from "../const";
import { configValue, updateConfig } from "./config";
import { log } from "./logs";
import { pool } from "./relays";

type PendingSigner = {
  signer: NostrConnectSigner;
  waitForSigner: Promise<void>;
};

type NbunksecSignerData = {
  nbunksec: string;
};

export const pendingSigner$ = new BehaviorSubject<PendingSigner | null>(null);

/** The user's active Nostr Connect signer account. */
export const signer$ = new BehaviorSubject<NostrConnectAccount<any> | null>(
  null,
);

// Setup bunker signers
NostrConnectSigner.pool = pool;

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function serializeSignerAccount(account: NostrConnectAccount, signer: NostrConnectSigner) {
  const serialized = account.toJSON();
  const nbunksec = signer.getNbunksec();

  return {
    ...serialized,
    signer: { nbunksec } satisfies NbunksecSignerData,
  };
}

function restoreNbunksecSigner(saved: { pubkey: string; signer: NbunksecSignerData }) {
  const { remote, clientKey, relays, bunkerSecret } = NostrConnectSigner.parseNbunksec(
    saved.signer.nbunksec,
  );
  const signer = new NostrConnectSigner({
    relays,
    pubkey: saved.pubkey,
    remote,
    bunkerSecret,
    pool,
    signer: new PrivateKeySigner(hexToBytes(clientKey)),
  });

  return new NostrConnectAccount(saved.pubkey, signer);
}

// Restore the signer from persisted config when the app starts or config changes.
configValue("signer").subscribe((signer) => {
  if (!signer) {
    signer$.next(null);
    return;
  }
  if (signer.id === signer$.value?.id) return;

  log("Restoring signer", { pubkey: signer.pubkey });

  switch (signer.type) {
    case "nostr-connect":
      if ("nbunksec" in signer.signer) {
        signer$.next(restoreNbunksecSigner(signer as typeof signer & { signer: NbunksecSignerData }));
        log("Restored signer from nbunksec", { pubkey: signer.pubkey });
      } else {
        signer$.next(NostrConnectAccount.fromJSON(signer));
        log("Restored legacy signer", { pubkey: signer.pubkey });
      }
      break;
    default:
      log("Unsupported signer type", { type: signer.type });
  }
});

export function getPendingSigner() {
  let pendingSigner = pendingSigner$.value;

  if (!pendingSigner) {
    log("Creating new signer");
    const signer = new NostrConnectSigner({
      pool,
      relays: DEFAULT_SIGNER_RELAYS,
    });
    const waitForSigner = signer.waitForSigner();
    waitForSigner.catch(() => {});
    log("Waiting for remote signer to connect", {
      relays: DEFAULT_SIGNER_RELAYS,
    });

    pendingSigner = { signer, waitForSigner };
    pendingSigner$.next(pendingSigner);
  }

  return pendingSigner;
}

export function getPendingSignerConnectUrl() {
  const { signer } = getPendingSigner();

  return signer.getNostrConnectURI({
    name: "Nostr Secretary",
    permissions: SIGNER_PERMISSIONS,
  });
}

async function saveSigner(signer: NostrConnectSigner, savePubkey: boolean) {
  log("Remote signer connected, reading public key");
  const pubkey = await signer.getPublicKey();
  log("Found pubkey", { pubkey });

  const account = new NostrConnectAccount(pubkey, signer);
  signer$.next(account);
  const serializedSigner = serializeSignerAccount(account, signer);
  log("Persisting signer nbunksec session", { pubkey });

  await updateConfig({
    ...(savePubkey ? { pubkey } : {}),
    signer: serializedSigner,
  });
  log("Saved signer nbunksec session", { pubkey });

  return { account, pubkey };
}

export async function savePendingSigner(options: { savePubkey?: boolean } = {}) {
  const pendingSigner = pendingSigner$.value;
  if (!pendingSigner) throw new Error("No signer available");

  const { signer, waitForSigner } = pendingSigner;
  log("Awaiting pending QR signer connection");
  await waitForSigner;
  log("Remote signer connected via QR");
  pendingSigner$.next(null);

  return saveSigner(signer, options.savePubkey ?? false);
}

export async function saveBunkerSigner(bunkerUri: string) {
  log("Connecting remote signer from bunker URI");
  const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri.trim(), {
    permissions: SIGNER_PERMISSIONS,
    pool,
  });
  log("Remote signer connected from bunker URI");

  return saveSigner(signer, false);
}

export async function clearSigner() {
  pendingSigner$.next(null);
  signer$.next(null);
  await updateConfig({ signer: undefined });
}
