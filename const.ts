import {
  NostrConnectSigner,
  type NostrConnectionClassMethods,
} from "applesauce-signers";
import { Permission } from "applesauce-signers/helpers";
import { kinds } from "nostr-tools";

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es"];
export const DEFAULT_SIGNER_RELAYS = [
  "wss://bucket.coracle.social",
  "wss://relay.nsec.app",
];
export const CACHI_GROUP_LINK = "https://chachi.chat/{hostname}/{group}";

/**
 * Permissions requested from a NIP-46 remote signer at connect time.
 * Covers: client-auth signing (kind 22242), kind-30078 app-data signing
 * (notification preferences sync, D2-13), NIP-44 self-encryption used
 * to encrypt/decrypt those preferences, and NIP-04 (kind-4) legacy-DM
 * decryption (D3-02) so a freshly connected bunker can decrypt legacy
 * direct messages. Receive-only: the NIP-04 encrypt permission is
 * deliberately not requested (D3-03 — no DM send surface exists in
 * this app).
 */
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
  Permission.Nip04Decrypt,
];
