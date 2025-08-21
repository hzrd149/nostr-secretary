# nostr-secretary

Stupid simple nostr notifications.

1. Download [bun](https://bun.sh) on server
1. Download [ntfy](https://ntfy.sh) on mobile device
1. Run `bunx https://github.com/hzrd149/nostr-secretary` or `docker run --name nostr-secretary -v $(pwd)/data:/app/data -p 8080:8080 hzrd149/nostr-secretary`
1. Open [http://localhost:8080](http://localhost:8080)
1. Enter pubkey
1. Scan QR code and subscribe to notifications
1. ...?
1. Profit!

## Installing on Umbrel

1. Add a community app store `https://github.com/hzrd149/umbrel-community-app-store`
1. Open `hzrd149 Community App Store`
1. Intall `Nostr Secretary`
