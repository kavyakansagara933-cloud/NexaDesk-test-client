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
 *   8. Send mouse click commands to the host
 *   9. Send right-click, double-click, and scroll (up and down) commands
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


/* ---------------- MOUSE CONTROL ---------------- */

/**
 * Converts the mouse position over the displayed video into
 * coordinates matching the actual resolution of the NexaDesk Host screen.
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
    return;
  }

  // Scale the displayed coordinates to the host's real resolution.
  const x = Math.round(
    (relativeX / rect.width) * hostWidth
  );

  const y = Math.round(
    (relativeY / rect.height) * hostHeight
  );

  const command = {
    type: "mouse-move",
    x,
    y,
  };

  controlChannel.send(
    JSON.stringify(command)
  );
});


/* ---------------- MOUSE CLICK ---------------- */

/**
 * Sends a left mouse click command to the NexaDesk Host.
 *
 * The mouse position is already updated by the mousemove handler,
 * so the host performs the click at the current cursor position.
 */
videoEl.addEventListener("click", () => {
  if (
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return;
  }

  const command = {
    type: "mouse-click",
  };

  console.log(
    "Sending mouse click command."
  );

  controlChannel.send(
    JSON.stringify(command)
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
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return;
  }

  const command = {
    type: "mouse-right-click",
  };

  console.log(
    "Sending mouse right-click command."
  );

  controlChannel.send(
    JSON.stringify(command)
  );
});


/* ---------------- MOUSE DOUBLE-CLICK ---------------- */

/**
 * Sends a double mouse click command to the NexaDesk Host.
 */
videoEl.addEventListener("dblclick", () => {
  if (
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return;
  }

  const command = {
    type: "mouse-double-click",
  };

  console.log(
    "Sending mouse double-click command."
  );

  controlChannel.send(
    JSON.stringify(command)
  );
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

  if (
    !controlChannel ||
    controlChannel.readyState !== "open"
  ) {
    return;
  }

  const direction =
    event.deltaY > 0 ? 1 : -1;

  const steps = Math.max(
    1,
    Math.round(Math.abs(event.deltaY) / 50)
  );

  const command = {
    type: "mouse-scroll",
    amount: direction * steps,
  };

  console.log(
    "Sending mouse scroll command:",
    command
  );

  controlChannel.send(
    JSON.stringify(command)
  );
});