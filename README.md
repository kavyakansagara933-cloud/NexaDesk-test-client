# Macky Test Client

A throwaway (but genuinely functional) WebRTC peer used to test the
Electron host end-to-end, before the real Android app exists. It plays
the same role the Android app eventually will: join with a pairing code,
receive the offer, answer it, exchange ICE candidates, and render the
incoming video stream.

This is plain HTML/JS — no build step, no dependencies.

## How to use it

1. Make sure `macky-host` is running (`npm start` in that project) and
   showing a pairing code
2. Open `index.html` in this folder directly in a browser (double-click
   it, or right-click → Open with → your browser)
3. Type the 6-character pairing code shown in Macky Host
4. Click **Join**
5. Watch the status update: connecting → joined → offer received →
   connected. Once connected, the host's screen should appear in the
   video element on this page.

## What this proves

If the video appears, the full signaling + WebRTC pipeline works
end-to-end: pairing, offer/answer exchange, ICE negotiation, and actual
peer-to-peer media streaming — everything the real Android app will also
need to do, just implemented in a browser instead of React Native.

## Note

This is a testing tool, not part of the final product. Once the Android
app exists and is verified working, this client isn't needed for
day-to-day use — but it's good to keep in the repo as a reusable way to
test the host in isolation going forward.
