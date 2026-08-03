# nostr-secretary

Stupid simple nostr notifications.

1. Download [bun](https://bun.sh) on server
1. Download [ntfy](https://ntfy.sh) on mobile device
1. Run `bunx https://github.com/hzrd149/nostr-secretary` or `docker run --rm -it -v $(pwd)/data:/app/data -p 8080:8080 ghcr.io/hzrd149/nostr-secretary:master`
1. Open [http://localhost:8080](http://localhost:8080)
1. Enter pubkey
1. Scan QR code and subscribe to notifications
1. ...?
1. Profit!

## Installing on Umbrel

1. Add a community app store `https://github.com/hzrd149/umbrel-community-app-store`
1. Open `hzrd149 Community App Store`
1. Intall `Nostr Secretary`

## NixOS

Add this repository to your flake inputs and import its NixOS module:

```nix
{
  inputs.nostr-secretary.url = "github:hzrd149/nostr-secretary";

  outputs = { nixpkgs, nostr-secretary, ... }: {
    nixosConfigurations.example = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        nostr-secretary.nixosModules.default
        {
          services.nostr-secretary = {
            enable = true;
            port = 8080;
            openFirewall = true;
          };
        }
      ];
    };
  };
}
```

The service stores its mutable configuration, including signer credentials, at
`/var/lib/nostr-secretary/config.json`. The file is managed by Nostr Secretary
and is deliberately not generated into the world-readable Nix store.
