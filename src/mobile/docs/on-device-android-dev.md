# Running the mobile app on a physical Android device (WSL2)

How to get the Uniffy dev build running on a real Android phone (e.g. Samsung S24)
over Wi-Fi, talking to a Metro bundler running inside WSL2. Follow the **Each
session** steps every time; the **One-time** and **Reference** sections explain
the values and the why.

## Reference values

| Thing | Value |
|---|---|
| `adb` binary (not on the non-interactive shell PATH) | `~/Android/Sdk/platform-tools/adb` |
| App package | `com.uniffy.app` |
| App URL scheme | `uniffy` |
| Metro port | `8081` |

Tip: export `ADB` once per shell so the commands below are copy-pasteable:

```bash
export ADB="$HOME/Android/Sdk/platform-tools/adb"
```

## Why the reverse tunnel (WSL2 networking)

WSL2 sits behind NAT, so its IP is not the LAN IP the phone can reach. Instead of
chasing IPs, we forward the phone's `localhost:8081` to WSL's Metro with
`adb reverse`. The dev client then always loads from `http://localhost:8081`,
which the tunnel routes to Metro. This sidesteps every IP mismatch.

## One-time (per phone / per computer)

1. **Enable Developer options** on the phone: Settings -> About phone ->
   Software information -> tap **Build number** 7 times -> enter PIN.
2. **Enable Wireless debugging**: Settings -> Developer options -> **Wireless
   debugging** (on).
3. **Pair** the computer to the phone (only needed the first time; the adb key
   persists afterward):
   - On the phone: Wireless debugging -> **Pair device with pairing code**. It
     shows a **pairing code** and an **IP address & port** (the *pairing* port).
   - On the computer:
     ```bash
     $ADB pair <IP>:<PAIRING_PORT> <PAIRING_CODE>
     ```

## Each session

The phone's ports change on reboot / when you toggle Wireless debugging, so read
the current values off the phone each time.

1. **Connect.** The main Wireless debugging screen shows **IP address & Port**
   (the *connect* port - different from the pairing port). Then verify:
   ```bash
   $ADB connect <IP>:<CONNECT_PORT>
   $ADB devices          # should list <IP>:<CONNECT_PORT>  device
   ```
   If you have never paired this computer, do the **Pair** step above first.

2. **Open the reverse tunnel** so the phone reaches Metro at localhost:
   ```bash
   $ADB reverse tcp:8081 tcp:8081
   ```

3. **Start Metro** (from `src/mobile`). Add `--clear` only when you want a clean
   rebuild (wipes the bundler cache; the first bundle then takes ~a minute):
   ```bash
   cd src/mobile
   npx expo start --dev-client        # or: npx expo start --dev-client --clear
   ```
   Wait until it is serving:
   ```bash
   curl -s http://localhost:8081/status   # -> packager-status:running
   ```

4. **Relaunch the app** pointed at Metro (re-assert the tunnel first in case
   Metro or the connection restarted):
   ```bash
   $ADB reverse tcp:8081 tcp:8081
   $ADB shell am force-stop com.uniffy.app
   $ADB shell am start -a android.intent.action.VIEW \
     -d "uniffy://expo-development-client/?url=http://localhost:8081"
   ```

5. **Verify** the phone is pulling the bundle - Metro's output should show a
   bundle request building toward 100%, then the app opens. For a backgrounded
   Metro, tail its log file to watch progress.

## Troubleshooting

- **`adb: command not found`** - the non-interactive shell does not have the
  Android SDK on PATH. Use the full path `~/Android/Sdk/platform-tools/adb` or
  export `ADB` as shown above.
- **`curl .../status` is empty** - Metro is not running; start it (step 3).
- **App opens but shows a connection error** - the reverse tunnel dropped; re-run
  `$ADB reverse tcp:8081 tcp:8081` (it is cleared when the adb server or the
  device connection restarts), then relaunch (step 4).
- **Only the connect port changed** - you do not need to pair again; the adb key
  from the first pairing persists. Just `$ADB connect <IP>:<CONNECT_PORT>`.
- **Fast Refresh not applying a change** - reload from the phone (shake ->
  Reload), or re-run step 4 to force a fresh load.

## Concrete example (one real session)

```bash
export ADB="$HOME/Android/Sdk/platform-tools/adb"
$ADB pair 192.168.10.109:44841 757327     # pairing IP:port + code from the phone
$ADB connect 192.168.10.109:39907         # connect IP:port from the phone
$ADB devices                              # 192.168.10.109:39907  device
$ADB reverse tcp:8081 tcp:8081

cd src/mobile
npx expo start --dev-client --clear       # cleared cache
# wait for: curl -s http://localhost:8081/status -> packager-status:running

$ADB reverse tcp:8081 tcp:8081
$ADB shell am force-stop com.uniffy.app
$ADB shell am start -a android.intent.action.VIEW \
  -d "uniffy://expo-development-client/?url=http://localhost:8081"
```
