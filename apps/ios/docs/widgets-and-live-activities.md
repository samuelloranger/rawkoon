# Widgets and Live Activities

The iOS app and `RawkoonWidgets` extension share a compact Home snapshot through
the `group.cloud.samlo.rawkoon` App Group. The extension has no server credentials.
The re-encode Live Activity is available to admins and receives remote ActivityKit
pushes through the Rawkoon API and push relay. The sleep timer Live Activity is
started and updated locally while an audiobook is playing.

## Apple signing setup

Before the next TestFlight archive:

1. Register `group.cloud.samlo.rawkoon` in Apple Developer and attach it to both
   `cloud.samlo.rawkoon` and `cloud.samlo.rawkoon.widgets`.
2. Enable App Groups and Push Notifications for the app ID. Enable App Groups for
   the widget extension ID.
3. Regenerate the **Rawkoon AppStore CI** App Store profile so it includes the
   App Group entitlement. Replace the GitHub secret
   `BUILD_PROVISION_PROFILE_BASE64` with the base64 encoded profile.
4. Create an App Store profile named **Rawkoon Widgets AppStore CI** for
   `cloud.samlo.rawkoon.widgets` using the existing distribution certificate.
   Store its base64 encoded contents in `WIDGET_PROVISION_PROFILE_BASE64`.

The CI workflow installs both profiles, and `ExportOptions.plist` maps both
bundle IDs to their profile names. No additional distribution certificate is
needed. The Mac Catalyst lane excludes the iOS widget extension and ActivityKit
code; it continues to use its existing profile.

## Server rollout

Apply the `live_activity_devices` Prisma migration before deploying the API.
Deploy the updated push relay before the API starts sending `/liveactivity`
requests. APNs uses the app's `cloud.samlo.rawkoon.push-type.liveactivity` topic.
