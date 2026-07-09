import { describe, test, expect } from "bun:test";
import { SIGNER_PERMISSIONS } from "../const";

describe("SIGNER_PERMISSIONS", () => {
  test("includes get_public_key (from buildSigningPermissions)", () => {
    expect(SIGNER_PERMISSIONS).toContain("get_public_key");
  });

  test("includes sign_event:22242 (ClientAuth kind, still requested)", () => {
    expect(SIGNER_PERMISSIONS).toContain("sign_event:22242");
  });

  test("includes sign_event:30078 (the new app-data kind — D2-13)", () => {
    expect(SIGNER_PERMISSIONS).toContain("sign_event:30078");
  });

  test("includes nip44_encrypt (D2-13)", () => {
    expect(SIGNER_PERMISSIONS).toContain("nip44_encrypt");
  });

  test("includes nip44_decrypt (D2-13)", () => {
    expect(SIGNER_PERMISSIONS).toContain("nip44_decrypt");
  });
});
