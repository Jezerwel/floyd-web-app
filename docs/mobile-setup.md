# Floyd on Android and iPhone

Use Chrome on Android to open the Floyd web app over HTTPS. You can install it from the Chrome menu. Use the native Floyd Feeder build on iPhone for Bluetooth access.

## Pair a feeder

1. In Arduino IDE, select **XIAO_ESP32S3** from the **esp32** package by Espressif Systems. Use version 3.3.13 and ArduinoJson 7 to compile and flash `firmware/FloydFeeder`.
2. For initial pairing, connect the XIAO by USB and open a serial monitor at 115200 baud. Enable **USB CDC On Boot** if the serial monitor does not show the feeder log.
3. Select **Connect feeder** and choose your Floyd feeder.
4. If your phone asks for a Bluetooth pairing code, enter the six digits printed in the serial monitor. Pair only with a feeder you can identify.

The feeder requires authenticated Bluetooth writes for motor commands, schedules, and clock sync. If a phone had a previous Bluetooth bond and pairing fails after flashing, remove the old pairing in the phone's Bluetooth settings and try again.

## XIAO ESP32S3 and HC-160A S2 wiring

| Signal | XIAO pin | Driver control input |
| --- | --- | --- |
| Impeller forward | D3 (GPIO4) | A |
| Impeller reverse | D1 (GPIO2) | B |
| Impeller PWM | D4 (GPIO5) | PA |
| Auger forward | D8 (GPIO7) | a |
| Auger reverse | D9 (GPIO8) | b |
| Auger PWM | D5 (GPIO6) | Pa |
| Ground | GND | G |

Button A connects D6 (GPIO43) to GND when pressed. Button B connects D7 (GPIO44) to GND when pressed. Internal pull-ups hold both pins high when released. The firmware brakes a motor with both direction outputs low and switches direction with PWM off. It never drives both direction outputs high.

The sketch uses 15 kHz PWM with a maximum duty of 98%. The app still sends speeds from 0 to 1023. [Seeed pin map](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/) · [HC-160A S2 connection diagrams](https://manuals.plus/m/f920b7568c6751c3a585a1ad914baef40151562fe72caf1b8724f64f3e78afcb.pdf)

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

On each physical phone, pair with the XIAO, confirm the feeder clock syncs, save a schedule, and reconnect to confirm the schedule was stored. On a feeder with its moving parts clear, run a short feed, stop it, and check the log. With Bluetooth off, check that the app reports a connection failure and lets you reconnect when Bluetooth returns.
