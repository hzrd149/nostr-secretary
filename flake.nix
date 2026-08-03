{
  description = "Nostr Secretary - simple Nostr notification server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f system (import nixpkgs {
            inherit system;
          })
        );

      sourceExclusions = [
        ".agents"
        ".codex"
        ".git"
        ".github"
        ".planning"
        "CLAUDE.md"
        "config.json"
        "node_modules"
      ];

      src = nixpkgs.lib.cleanSourceWith {
        src = ./.;
        filter =
          path: _type:
          !(nixpkgs.lib.elem (baseNameOf path) sourceExclusions);
      };
    in
    {
      packages = forAllSystems (
        _system: pkgs:
        (import ./nix/package.nix {
            inherit pkgs src systems;
            version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
          })
        // nixpkgs.lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "x86_64-linux") {
          nixos-vm = self.nixosConfigurations.nostr-secretary-vm.config.system.build.vm;
        }
      );

      nixosModules.default = import ./nix/module.nix self;

      nixosConfigurations.nostr-secretary-vm = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          "${nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"
          self.nixosModules.default
          ./examples/nixos-vm/configuration.nix
        ];
      };

      apps = forAllSystems (system: _pkgs: {
        default = {
          type = "app";
          program = "${nixpkgs.lib.getExe self.packages.${system}.default}";
          meta.description = "Run Nostr Secretary";
        };
      });

      devShells = forAllSystems (_system: pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.bun ];
        };
      });

      checks = forAllSystems (
        system: pkgs:
        {
          package = self.packages.${system}.default;
        }
        // nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          nixos-module = pkgs.testers.runNixOSTest (import ./nix/test.nix { inherit self; });
        }
      );
    };
}
