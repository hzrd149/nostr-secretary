# Nostr Secretary NixOS VM

This example builds a disposable NixOS QEMU VM running Nostr Secretary as a
systemd service. Host port `18080` is forwarded to the service's guest port
`8080`.

From the repository root, build the VM with:

```sh
nix build path:$PWD#nixos-vm
```

Start it with:

```sh
./result/bin/run-nostr-secretary-vm-vm
```

Wait for the VM to finish booting, then open <http://127.0.0.1:18080> on the
host. The VM console automatically logs in as `root`, so service status and
logs can be inspected inside the VM:

```sh
systemctl status nostr-secretary
journalctl -u nostr-secretary -f
```

Shut the VM down from its console with `poweroff`, or press `Ctrl-C` in the
terminal that launched it. The default VM disk is temporary; configuration
created through the web interface is not intended to survive rebuilding the
example VM.
