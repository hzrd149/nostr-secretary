{ self }:
{
  name = "nostr-secretary-module";

  nodes.machine =
    { ... }:
    {
      imports = [ self.nixosModules.default ];

      services.nostr-secretary = {
        enable = true;
        port = 18080;
        openFirewall = true;
      };
    };

  testScript = ''
    machine.start()
    machine.wait_for_unit("nostr-secretary.service")
    machine.wait_for_open_port(18080)

    machine.succeed("curl --fail --silent http://127.0.0.1:18080/ | grep -F 'Nostr Secretary'")
    machine.succeed("curl --fail --silent http://127.0.0.1:18080/layout.css | grep -F 'box-sizing'")
    machine.succeed("test -s /var/lib/nostr-secretary/config.json")

    original_config = machine.succeed("sha256sum /var/lib/nostr-secretary/config.json").split()[0]
    machine.succeed("systemctl restart nostr-secretary.service")
    machine.wait_for_unit("nostr-secretary.service")
    machine.wait_for_open_port(18080)
    restarted_config = machine.succeed("sha256sum /var/lib/nostr-secretary/config.json").split()[0]
    assert original_config == restarted_config

    machine.succeed("systemctl show nostr-secretary.service -P DynamicUser | grep -Fx yes")
    machine.succeed("systemctl show nostr-secretary.service -P StateDirectory | grep -Fx nostr-secretary")
  '';
}
