{ ... }:
{
  networking.hostName = "nostr-secretary-vm";

  services.nostr-secretary = {
    enable = true;
    port = 8080;
  };

  virtualisation = {
    cores = 2;
    memorySize = 1024;
    forwardPorts = [
      {
        from = "host";
        host.port = 18080;
        guest.port = 8080;
      }
    ];
  };

  services.getty.autologinUser = "root";
  system.stateVersion = "26.05";
}
