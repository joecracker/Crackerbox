# Using Crackerbox from your phone

Crackerbox runs on your computer. Your phone just shows it. Settings has an
**Add a phone** section with a QR code: scan it with the phone's camera and
Crackerbox opens on the phone, no typing.

There are two ways to connect. The first needs no setup. The second lets you use
Crackerbox away from home and **needs your own free Cloudflare account**. That
setup is on you: Crackerbox does not create or run it for you.

## 1. On home Wi-Fi (no setup)

1. Put the phone on the same Wi-Fi as the computer.
2. Open **Settings > Add a phone**, choose **On home Wi-Fi**, and scan the code.

Things to know:

- There is no sign-in on home Wi-Fi. Anyone on your network who can reach the
  computer can open Crackerbox. Only use this on a network you trust.
- Windows Firewall may block the phone. Allow Crackerbox on **Private**
  networks (the phone connects to port 4319).
- Home Wi-Fi uses plain `http`, so Chrome will not offer to install it as an app.
  The remote address below is what gives you the home-screen icon.

## 2. From anywhere (your own Cloudflare account)

You need:

- A free Cloudflare account.
- A domain name you own, added to that Cloudflare account.
- `cloudflared` (Cloudflare's tunnel program) installed on the computer that
  runs Crackerbox.

Steps:

1. **Make a tunnel** from the computer to Cloudflare, and give it a host name on
   your domain, for example `remote.yourdomain.com`.
2. **Point the host name at Crackerbox.** In the tunnel's settings the service
   is `http://127.0.0.1:4319`. A config file for it looks like this:

   ```yaml
   tunnel: <your tunnel id>
   credentials-file: <path to your tunnel's .json file>

   ingress:
     - hostname: remote.yourdomain.com
       service: http://127.0.0.1:4319
     - service: http_status:404
   ```

3. **Run the tunnel as a service** so it starts with the computer.
4. **Lock it with Cloudflare Access.** In Cloudflare Zero Trust, add a
   self-hosted application for `remote.yourdomain.com` with a policy that allows
   only your own email. This step is not optional. Crackerbox has no sign-in of
   its own, so without it anyone who finds the address can use your computer's
   Crackerbox.
5. In Crackerbox, open **Settings > Add a phone**, type `remote.yourdomain.com`
   in **Remote address**, and press **Save**.
6. Choose **From anywhere** and scan the code. Cloudflare asks you to sign in when
   it needs to. The phone then shows **Tap here to install Crackerbox**, which
   puts the Crackerbox icon on your home screen.

### App previews through the tunnel

Previews of the apps you build are shown on a second ordinary web port (8443) on
the same host name. Cloudflare answers on that port for your host name, so there
is nothing extra to set up, and the sign-in you already did covers it.

### If something does not work

- **Orange "Reconnecting" bar flashing:** make sure only one copy of the page is
  open on the phone (a browser tab and the installed icon at the same time).
- **"This preview could not be loaded":** the tunnel may not be passing the
  preview port through. Check `main.log` in Crackerbox's logs folder for lines
  starting with `Frame request`.
- **No "Install app" in Chrome's menu:** open the remote address (https), not the
  home Wi-Fi one, and reload once.
