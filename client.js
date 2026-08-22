/**
 * Macky Test Client
 * ------------------
 * A throwaway (but real) WebRTC peer used to test the host end-to-end,
 * before the actual Android app exists. It does exactly what the Android
 * app will eventually do:
 *   1. Join a room using the pairing code
 *   2. Receive the host's SDP offer
 *   3. Create a real SDP answer and send it back
 *   4. Exchange ICE candidates
 *   5. Render the incoming video track once the connection is established
 *
 * This is plain browser JavaScript - open index.html directly in a browser
 * (or via a simple local server), no build step needed.
 */

const SIGNALING_SERVER_URL = "wss://macky-signaling-server.onrender.com";

const codeInput = document.getElementById("codeInput");
const joinBtn = document.getElementById("joinBtn");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("remoteVideo");

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let socket = null;
let peerConnection = null;

joinBtn.addEventListener("click", () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    statusEl.textContent = "Enter the 6-character code shown in Macky Host.";
    return;
  }

  joinBtn.disabled = true;
  codeInput.disabled = true;
  statusEl.textContent = "Connecting to signaling server...";

  socket = new WebSocket(SIGNALING_SERVER_URL);

  socket.addEventListener("open", () => {
    statusEl.textContent = "Connected. Joining room...";
    socket.send(JSON.stringify({ type: "client-join", code }));
  });

  socket.addEventListener("message", async (event) => {
    const msg = JSON.parse(event.data);
    console.log("[received]", msg);

    if (msg.type === "joined") {
      statusEl.textContent = "Joined. Waiting for host's offer...";
    }

    if (msg.type === "error") {
      statusEl.textContent = `Error: ${msg.message}`;
      joinBtn.disabled = false;
      codeInput.disabled = false;
    }

    if (msg.type === "offer") {
      statusEl.textContent = "Offer received. Creating answer...";
      await handleOffer(msg.offer);
    }

    if (msg.type === "ice-candidate") {
      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(msg.candidate);
        } catch (err) {
          console.error("Failed to add ICE candidate:", err);
        }
      }
    }

    if (msg.type === "peer-disconnected") {
      statusEl.textContent = "Host disconnected.";
    }
  });

  socket.addEventListener("close", () => {
    statusEl.textContent = "Disconnected from signaling server.";
  });

  socket.addEventListener("error", () => {
    statusEl.textContent = "Connection error.";
  });
});

/**
 * Mirrors what the host does, but in reverse: we receive the offer instead
 * of creating one, and we create an answer instead of expecting one.
 */
async function handleOffer(offer) {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  // As soon as the host's video track arrives, attach it to our <video>
  // element so it actually renders on screen.
  peerConnection.addEventListener("track", (event) => {
    videoEl.srcObject = event.streams[0];
    videoEl.style.display = "block";
    statusEl.textContent = "Connected - streaming host's screen.";
  });

  peerConnection.addEventListener("icecandidate", (event) => {
    if (event.candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
        })
      );
    }
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    console.log("WebRTC connection state:", peerConnection.connectionState);
  });

  await peerConnection.setRemoteDescription(offer);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "answer", answer }));
    console.log("Answer sent.");
  }
}
