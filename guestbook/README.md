# Guestbook + visitor counter

A tiny server that every visitor to the site shares, so guestbook entries and the visitor count are the same for everyone.
Plain Node, nothing to install.

## Putting it on Railway

1. On Railway, create a new project from the **ZOEBUBBL/Webshite** GitHub repo and set its **Root Directory** to `guestbook`.
2. Attach a **volume** mounted at `/data`. Without it, every redeploy wipes the guestbook and the count.
3. Add these variables:
   - `DATA_DIR` = `/data`
   - `ADMIN_TOKEN` = a long password only you know
4. Under Settings → Networking, click **Generate Domain** to get its address.
5. Paste that address into `index.html`, near the top of the script:
   `const GB_API = 'https://your-guestbook.up.railway.app';`
   then commit and push.

Until `GB_API` is filled in, or whenever the server is down, the site quietly falls back to saving notes on the visitor's own device.

## Looking after it

- **Delete entries:** go to the server's address with `/admin` on the end and enter your `ADMIN_TOKEN`.
- **Spam protection:** links are refused, each visitor can post once every 30 seconds, and a hidden field catches bots.
- **Optional variables:**
  - `START_HITS`: where the counter starts (default 665)
  - `ALLOWED_ORIGINS`: which sites may use it (default `https://zoebubbl.github.io,http://localhost:8765`)

## Running it on your PC

```
node guestbook/server.js
```

It saves to `guestbook/data/`.
