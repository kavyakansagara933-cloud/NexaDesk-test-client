/**
 * NexaDesk Test Client
 * --------------------
 * A real WebRTC peer used to test the NexaDesk Host before the Android
 * application exists.
 *
 * Flow:
 *   1. Join a room using the pairing code
 *   2. Receive the host's SDP offer
 *   3. Create and send an SDP answer
 *   4. Exchange ICE candidates
 *   5. Render the incoming screen stream
 *   6. Receive the "control" DataChannel
 *   7. Send accurately scaled mouse coordinates to the host
 *   8. Send left button press/release (clicks, double-clicks and drags)
 *   9. Send right-click and scroll (up and down) commands
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

// True while the left mouse button is held down over the video.
let leftButtonDown = false;


/* ---------------- JOIN SIGNALING SERVER ---------------- */

joinBtn.addEventListener("click", () => {
  const code = codeInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    statusEl.textContent =
      "Enter the 6-character code shown in NexaDesk Host.";
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

    console.log("[received]", msg.type);

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
        "NexaDesk Host disconnected.";
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
 * Receives the NexaDesk Host WebRTC offer and creates an answer.
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

      // Ask the browser to show each video frame as soon as it
      // arrives instead of holding frames back to smooth things out.
      // This lowers the delay on the picture. Not every browser
      // supports these settings, so each is attempted safely.
      try {
        if ("jitterBufferTarget" in event.receiver) {
          event.receiver.jitterBufferTarget = 0;
        }
      } catch (err) {
        console.warn(
          "jitterBufferTarget not supported:",
          err
        );
      }

      try {
        if ("playoutDelayHint" in event.receiver) {
          event.receiver.playoutDelayHint = 0;
        }
      } catch (err) {
        console.warn(
          "playoutDelayHint not supported:",
          err
        );
      }

      statusEl.textContent =
        "Connected - streaming NexaDesk Host's screen.";
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


/* ---------------- HELPERS ---------------- */

/**
 * Sends a command through the control DataChannel.
 * Returns true if it was sent, false if the channel isn't open yet.
 */
function sendCommand(command) {
  if (
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return false;
  }

  controlChannel.send(
    JSON.stringify(command)
  );

  return true;
}

/**
 * Converts a mouse event over the displayed video into
 * coordinates matching the actual resolution of the NexaDesk Host screen.
 * Returns null if the video size isn't known yet.
 */
function getHostPosition(event) {
  const rect =
    videoEl.getBoundingClientRect();

  // Position inside the displayed video.
  const relativeX =
    event.clientX - rect.left;

  const relativeY =
    event.clientY - rect.top;

  // Actual resolution of the incoming NexaDesk Host screen.
  const hostWidth =
    videoEl.videoWidth;

  const hostHeight =
    videoEl.videoHeight;

  // Wait until the video metadata is available.
  if (
    hostWidth === 0 ||
    hostHeight === 0 ||
    rect.width === 0 ||
    rect.height === 0
  ) {
    return null;
  }

  // Scale the displayed coordinates to the host's real resolution.
  return {
    x: Math.round(
      (relativeX / rect.width) * hostWidth
    ),
    y: Math.round(
      (relativeY / rect.height) * hostHeight
    ),
  };
}


/* ---------------- MOUSE MOVEMENT ---------------- */

/**
 * Some mice report 500+ positions per second. The host cannot use that
 * many, and sending them all only builds up a delay. Instead we keep
 * the newest position and send at most ONE move per screen refresh
 * (about 60 per second).
 */
let pendingMove = null;
let moveFrameRequested = false;
let lastSentX = null;
let lastSentY = null;

// If the connection is backed up, skip moves instead of queueing them.
const MAX_BUFFERED_BYTES = 4096;

function scheduleMove(position) {
  pendingMove = position;

  if (moveFrameRequested) {
    return;
  }

  moveFrameRequested = true;

  requestAnimationFrame(() => {
    moveFrameRequested = false;

    const move = pendingMove;
    pendingMove = null;

    if (!move) {
      return;
    }

    // Nothing changed since the last move we sent.
    if (move.x === lastSentX && move.y === lastSentY) {
      return;
    }

    // The connection is still busy sending older data - skip this one.
    if (
      controlChannel &&
      controlChannel.bufferedAmount > MAX_BUFFERED_BYTES
    ) {
      return;
    }

    if (
      sendCommand({
        type: "mouse-move",
        x: move.x,
        y: move.y,
      })
    ) {
      lastSentX = move.x;
      lastSentY = move.y;
    }
  });
}

videoEl.addEventListener("mousemove", (event) => {
  const position = getHostPosition(event);

  if (!position) {
    return;
  }

  scheduleMove(position);
});


/* ---------------- LEFT BUTTON: CLICK, DOUBLE-CLICK, DRAG ---------------- */

/**
 * Instead of sending a single "click" command, we send the raw
 * button press and release. The host presses and releases the real
 * Windows mouse button, so:
 *   - press + release at the same spot  -> a normal click
 *   - two quick press/release pairs     -> a double-click (Windows handles it)
 *   - press, move, release              -> a drag
 */
videoEl.addEventListener("mousedown", (event) => {
  // Left button only. Right-click is handled by "contextmenu" below.
  if (event.button !== 0) {
    return;
  }

  // Stop the browser from starting its own drag/selection on the video.
  event.preventDefault();

  // Drop any older waiting move so it can't arrive after the press.
  pendingMove = null;

  // Make sure the host cursor is exactly where we pressed.
  const position = getHostPosition(event);

  if (position) {
    if (
      sendCommand({
        type: "mouse-move",
        x: position.x,
        y: position.y,
      })
    ) {
      lastSentX = position.x;
      lastSentY = position.y;
    }
  }

  if (sendCommand({ type: "mouse-down" })) {
    leftButtonDown = true;

    console.log(
      "Sending mouse-down command."
    );
  }
});

/**
 * Listen on the whole window (not just the video) so the button is
 * still released on the host if the mouse is let go outside the video.
 */
window.addEventListener("mouseup", (event) => {
  if (event.button !== 0 || !leftButtonDown) {
    return;
  }

  leftButtonDown = false;

  // Drop any older waiting move so it can't arrive after the release.
  pendingMove = null;

  sendCommand({ type: "mouse-up" });

  console.log(
    "Sending mouse-up command."
  );
});


/* ---------------- MOUSE RIGHT-CLICK ---------------- */

/**
 * Sends a right mouse click command to the NexaDesk Host.
 * Prevents the browser's own right-click context menu from appearing
 * over the video, since that's not useful here.
 */
videoEl.addEventListener("contextmenu", (event) => {
  event.preventDefault();

  if (
    sendCommand({ type: "mouse-right-click" })
  ) {
    console.log(
      "Sending mouse right-click command."
    );
  }
});


/* ---------------- MOUSE SCROLL ---------------- */

/**
 * Sends a scroll command to the NexaDesk Host.
 *
 * The amount is signed, matching the browser's wheel direction:
 *   positive -> scroll down
 *   negative -> scroll up
 */
videoEl.addEventListener("wheel", (event) => {
  event.preventDefault();

  const direction =
    event.deltaY > 0 ? 1 : -1;

  const steps = Math.max(
    1,
    Math.round(Math.abs(event.deltaY) / 50)
  );

  sendCommand({
    type: "mouse-scroll",
    amount: direction * steps,
  });
});