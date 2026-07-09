import {
  NostrConnectSigner,
  type NostrConnectionClassMethods,
} from "applesauce-signers";
import { kinds } from "nostr-tools";

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es"];
export const DEFAULT_SIGNER_RELAY = "wss://relay.nsec.app";
export const CACHI_GROUP_LINK = "https://chachi.chat/{hostname}/{group}";

/**
 * Permissions requested from a NIP-46 remote signer at connect time.
 * Covers: client-auth signing (kind 22242), kind-30078 app-data signing
 * (notification preferences sync, D2-13), and NIP-44 self-encryption used
 * to encrypt/decrypt those preferences.
 */
export const SIGNER_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078]),
  "nip44_encrypt",
  "nip44_decrypt",
];
