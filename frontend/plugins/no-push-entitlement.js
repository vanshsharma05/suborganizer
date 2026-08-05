/**
 * Removes the push notification entitlement this app does not use.
 *
 * `expo-notifications` writes `aps-environment` into the entitlements
 * unconditionally — see node_modules/expo-notifications/plugin/build/
 * withNotificationsIOS.js, which sets it whenever the plugin is present. That is
 * right for most apps using the library and wrong for this one: every
 * notification here is scheduled on the device by
 * `Notifications.scheduleNotificationAsync`. Nothing is sent from a server,
 * there is no APNs key, and no push token is ever requested.
 *
 * The entitlement is not free to leave in. Xcode refuses to sign against a
 * provisioning profile that lacks the matching capability, and the first iOS
 * build failed on exactly that:
 *
 *     Provisioning profile "..." doesn't include the aps-environment entitlement
 *
 * The alternative is enabling Push Notifications on the App ID, which needs the
 * Account Holder and asks Apple for a permission the app has no use for.
 * Declaring capabilities you never exercise is also something App Review reads
 * as carelessness at best.
 *
 * MUST be registered FIRST in the plugins array, ahead of expo-notifications.
 * Mods run in the reverse of the order their plugins are listed — each new mod
 * wraps the previous one, so the last plugin registered is the first to run.
 * Listed after expo-notifications, this deletes a key that has not been written
 * yet and silently achieves nothing; the introspected config still showed
 * `aps-environment: development` until it was moved to the top.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
