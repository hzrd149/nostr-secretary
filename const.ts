import {
  NostrConnectSigner,
  type NostrConnectionClassMethods,
} from "applesauce-signers";
import { kinds } from "nostr-tools";

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es"];
export const DEFAULT_SIGNER_RELAY = "wss://relay.nsec.app";
export const CACHI_GROUP_LINK = "https://chachi.chat/{hostname}/{group}";

export const SIGNER_PERMISSIONS = NostrConnectSigner.buildSigningPermissions([
  kinds.ClientAuth,
]);
