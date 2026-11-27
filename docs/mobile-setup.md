# Floyd on Android and iPhone

Use Chrome on Android to open the Floyd web app over HTTPS. You can install it from the Chrome menu. Use the native Floyd Feeder build on iPhone for Bluetooth access.

## Pair a feeder

1. Flash the matching sketch in `firmware/FloydFeeder` to the Arduino Nano ESP32.
2. For initial pairing, connect the Nano by USB and open a serial monitor at 115200 baud.
3. Select **Connect feeder** and choose your Floyd feeder.
4. If your phone asks for a Bluetooth pairing code, enter the six digits printed in the serial monitor. Pair only with a feeder you can identify.

The feeder requires authenticated Bluetooth writes for motor commands, schedules, and clock sync. If a phone had a previous Bluetooth bond and pairing fails after flashing, remove the old pairing in the phone's Bluetooth settings and try again.

## Install the iPhone development build

Use macOS with Xcode 26 or later, Node.js 22 or later, and a physical iPhone. From the app repository, run:

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode, select a signing team and a bundle identifier available to that team. Select your iPhone and run the App target. The app bundles the same Floyd interface and uses the phone's native Bluetooth connection.

## Check both phones

On each physical phone, pair with the Nano, confirm the feeder clock syncs, save a schedule, and reconnect to confirm the schedule was stored. On a feeder with its moving parts clear, run a short feed, stop it, and check the log. With Bluetooth off, check that the app reports a connection failure and lets you reconnect when Bluetooth returns.
