# NexaDesk Test Client

A functional WebRTC test client used to test NexaDesk Host end-to-end before the real Android application exists.

It performs the same core role that the NexaDesk Android application will eventually perform:

- Join a session using a 6-character pairing code
- Receive the WebRTC offer from NexaDesk Host
- Create and send a WebRTC answer
- Exchange ICE candidates
- Receive and render the host's screen stream
- Receive the remote-control DataChannel
- Send scaled mouse coordinates to NexaDesk Host

This project uses plain HTML and JavaScript. There is no build step and no external dependency.

## How to Use It

1. Make sure `NexaDesk Host` is running:

```bash
npm start