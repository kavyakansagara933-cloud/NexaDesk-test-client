/**
 * Macky Test Client
 * ------------------
 * A real WebRTC peer used to test the Macky Host before the Android
 * application exists.
 *
 * Flow:
 *   1. Join a room using the pairing code
 *   2. Receive the host's SDP offer
 *   3. Create and send an SDP answer
 *   4. Exchange ICE candidates
 *   5. Render the incoming screen stream
 *   6. Receive the "control" DataChannel
 *   7. Send mouse coordinates when the user moves over the streamed screen
 */

const SIGNALING_SERVER_URL =
  "wss://macky-signaling-server.onrender.com";

const codeInput = document.getElementById("codeInput");
const joinBtn = document.getElementById("joinBtn");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("remoteVideo");

const RTC_CONFIG = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
};

let socket = null;
let peerConnection = null;
let controlChannel = null;


/* ---------------- JOIN SIGNALING SERVER ---------------- */

joinBtn.addEventListener("click", () => {
  const code = codeInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    statusEl.textContent =
      "Enter the 6-character code shown in Macky Host.";
    return;
  }

  joinBtn.disabled = true;
  codeInput.disabled = true;

  statusEl.textContent =
    "Connecting to signaling server...";

  socket = new WebSocket(SIGNALING_SERVER_URL);

  socket.addEventListener("open", () => {
    statusEl.textContent =
      "Connected. Joining room...";

    socket.send(
      JSON.stringify({
        type: "client-join",
        code,
      })
    );
  });

  socket.addEventListener("message", async (event) => {
    const msg = JSON.parse(event.data);

    console.log("[received]", msg);

    if (msg.type === "joined") {
      statusEl.textContent =
        "Joined. Waiting for host's offer...";
    }

    if (msg.type === "error") {
      statusEl.textContent =
        `Error: ${msg.message}`;

      joinBtn.disabled = false;
      codeInput.disabled = false;
    }

    if (msg.type === "offer") {
      statusEl.textContent =
        "Offer received. Creating answer...";

      await handleOffer(msg.offer);
    }

    if (msg.type === "ice-candidate") {
      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(
            msg.candidate
          );
        } catch (err) {
          console.error(
            "Failed to add ICE candidate:",
            err
          );
        }
      }
    }

    if (msg.type === "peer-disconnected") {
      statusEl.textContent =
        "Host disconnected.";
    }
  });

  socket.addEventListener("close", () => {
    statusEl.textContent =
      "Disconnected from signaling server.";
  });

  socket.addEventListener("error", () => {
    statusEl.textContent =
      "Connection error.";
  });
});


/* ---------------- WEBRTC CONNECTION ---------------- */

/**
 * Receives the host's WebRTC offer and creates an answer.
 */
async function handleOffer(offer) {
  peerConnection =
    new RTCPeerConnection(RTC_CONFIG);


  /* ---------- CONTROL DATACHANNEL ---------- */

  peerConnection.addEventListener(
    "datachannel",
    (event) => {
      if (event.channel.label === "control") {
        controlChannel = event.channel;

        controlChannel.addEventListener(
          "open",
          () => {
            console.log(
              "Control DataChannel opened."
            );
          }
        );

        controlChannel.addEventListener(
          "message",
          (event) => {
            console.log(
              "Control message received:",
              event.data
            );
          }
        );

        controlChannel.addEventListener(
          "close",
          () => {
            console.log(
              "Control DataChannel closed."
            );
          }
        );
      }
    }
  );


  /* ---------- RECEIVE SCREEN STREAM ---------- */

  peerConnection.addEventListener(
    "track",
    (event) => {
      videoEl.srcObject =
        event.streams[0];

      videoEl.style.display =
        "block";

      statusEl.textContent =
        "Connected - streaming host's screen.";
    }
  );


  /* ---------- SEND ICE CANDIDATES ---------- */

  peerConnection.addEventListener(
    "icecandidate",
    (event) => {
      if (
        event.candidate &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.send(
          JSON.stringify({
            type: "ice-candidate",
            candidate: event.candidate,
          })
        );
      }
    }
  );


  /* ---------- CONNECTION STATE ---------- */

  peerConnection.addEventListener(
    "connectionstatechange",
    () => {
      console.log(
        "WebRTC connection state:",
        peerConnection.connectionState
      );
    }
  );


  /* ---------- CREATE ANSWER ---------- */

  await peerConnection.setRemoteDescription(
    offer
  );

  const answer =
    await peerConnection.createAnswer();

  await peerConnection.setLocalDescription(
    answer
  );

  if (
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(
      JSON.stringify({
        type: "answer",
        answer,
      })
    );

    console.log("Answer sent.");
  }
}


/* ---------------- MOUSE CONTROL ---------------- */

/**
 * When the user moves their mouse over the streamed video,
 * calculate the position relative to the video and send it
 * to Macky Host through the WebRTC DataChannel.
 */
videoEl.addEventListener("mousemove", (event) => {
  if (
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return;
  }

  const rect =
    videoEl.getBoundingClientRect();

  const x =
    Math.round(event.clientX - rect.left);

  const y =
    Math.round(event.clientY - rect.top);

  const command = {
    type: "mouse-move",
    x,
    y,
  };

  controlChannel.send(
    JSON.stringify(command)
  );
});