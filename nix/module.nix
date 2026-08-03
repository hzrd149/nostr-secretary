self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nostr-secretary;
in
{
  options.services.nostr-secretary = {
    enable = lib.mkEnableOption "Nostr Secretary notification server";

    package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "nostr-secretary" { };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "TCP port on which Nostr Secretary listens.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the configured Nostr Secretary TCP port in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    networking.firewall.allowedTCPPorts = lib.optional cfg.openFirewall cfg.port;

    systemd.services.nostr-secretary = {
      description = "Nostr Secretary notification server";
      documentation = [ "https://github.com/hzrd149/nostr-secretary" ];
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = {
        CONFIG = "/var/lib/nostr-secretary/config.json";
        PORT = toString cfg.port;
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
        StateDirectory = "nostr-secretary";
        WorkingDirectory = "/var/lib/nostr-secretary";
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RestrictSUIDSGID = true;
      };
    };
  };
}
