# Privacy policy

Rawkoon is self-hosted software. You, or whoever runs your Rawkoon server,
control that server and the data on it. The Rawkoon project doesn't run your
server and can't see what's on it.

This policy covers the Rawkoon iPhone and Mac apps and the push relay that the
project operates.

## What the apps collect

The apps have no analytics, advertising, or tracking, and no third-party SDKs
that collect data. The project doesn't collect any personal data through them.

## What the apps send to your server

The apps only talk to the server address you enter at sign-in. They send:

- your email and password, or a single sign-on flow run by your server, to sign
  in;
- the requests, searches, and library changes you make;
- your listening and reading progress;
- if you allow notifications, this device's push token, name, iOS version, and
  app version, so the server can list the device and send it notifications.

Your server's administrator is responsible for that data. Signing out
unregisters this device's push token and removes the session and server address
from the device. Settings > Devices lists your other registered devices, and you
can remove any of them there.

## Data kept on the device

The server address and sign-in token are stored in the iOS Keychain. Downloaded
audiobook chapters, ebooks, cached screens, and a playback-position journal stay
in the app's own storage. Settings can clear the downloaded chapters and the
cached screens, and deleting the app removes all of it.

## Push notifications

Apple only accepts a notification signed with the app publisher's credentials,
so a self-hosted server can't reach Apple directly. It sends each notification
through the Rawkoon push relay, which forwards it to Apple Push Notification
service.

The relay receives the device push token and the notification's title and body.
It doesn't store them or write them to its logs. For rate limiting, it keeps
counts per token and per IP address in memory for a short time. Server operators
can run their own relay instead by setting `PUSH_RELAY_URL`.

## Other network requests

- Posters, backdrops, and covers load from whatever address your server returns
  for them. That may be your server itself or the metadata provider it uses,
  such as TMDB.
- The sign-in screen loads single sign-on provider icons from the jsDelivr CDN.
- Apple handles push delivery, TestFlight feedback, and crash reports if you've
  chosen to share them with developers.

Those services receive your device's IP address, as any web request does.

## Children

Rawkoon isn't directed at children and doesn't knowingly collect data from
them.

## Changes and contact

Changes to this policy are published on this page and in the project's git
history. For questions, open an issue on
[GitHub](https://github.com/samuelloranger/rawkoon/issues). To report a security
issue, see the
[security policy](https://github.com/samuelloranger/rawkoon/security/policy).
