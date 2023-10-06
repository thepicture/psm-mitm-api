const Websocket = require("websocket").w3cwebsocket;
const { HttpsProxyAgent } = require("https-proxy-agent");
const { Worker, receiveMessageOnPort } = require("node:worker_threads");
const config = require("./config");

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const getProxy = () => {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  const { port1: localPort, port2: workerPort } = new MessageChannel();

  new Worker("./fetcher.js", {
    workerData: { buffer, port: workerPort },
    transferList: [workerPort],
  });

  Atomics.wait(buffer, 0, 0);

  const { message: proxy } = receiveMessageOnPort(localPort);

  console.info(`Fetched proxy ${proxy}`);

  return proxy;
};

const log = (message, isInterlocutor) => {
  const date = `[${new Date().toISOString()}] `;
  const shift = isInterlocutor ? 0 : process.stdout.columns;
  const prefix = isInterlocutor ? `${date} ` : "";
  const postfix = isInterlocutor ? "" : ` ${date}`;
  const formatted = `${prefix}${message}${postfix}`.padStart(shift);

  return console.log(formatted);
};

const getWebsocketArgs = () => [
  "ws://pogovorisomnoi.ru:8008/chat",
  null,
  null,
  {
    "user-agent": Math.random().toString(),
  },
  null,
  {
    tlsOptions: {
      agent: new HttpsProxyAgent(getProxy()),
    },
  },
];

let mounted = false;

const [bot1, bot2] = ["you", "me"].map((name) => {
  let ws = new Websocket(...getWebsocketArgs());
  ws.emit = (json) => {
    try {
      ws.send(JSON.stringify(json));
    } catch {
      console.info("Reconnecting...");
    }
  };

  const rotate = () => {
    const fresh = new Websocket(...getWebsocketArgs());

    fresh.emit = (json) => fresh.send(JSON.stringify(json));

    fresh.rotate = rotate;
    fresh.onopen = ws.onopen;
    fresh.onclose = ws.onclose;
    fresh.onerror = ws.onerror;
    fresh.onmessage = ws.onmessage;

    ws.close();
    ws = fresh;
  };

  ws.rotate = rotate;

  return {
    name,
    connection: ws,
  };
});

if (!mounted) {
  mounted = true;

  process.stdin.on("data", (buffer) => {
    const [who, message] = buffer
      .toString("utf8")
      .match(/^(\S+)\s(.*)/)
      .slice(1);

    if (!message) {
      return;
    }

    const isMe = who === "me";

    const which = isMe ? bot1 : bot2;

    log(
      `${
        which.name == "you" ? "me" : "you"
      } intercepted with "${message.trimEnd()}"`,
      isMe
    );

    which.connection.emit({
      event: "send_message",
      message,
    });
  });
}

let lastJoinedAt = -Infinity;

[
  [bot1, bot2],
  [bot2, bot1],
].forEach(
  ([{ connection: connection1, name }, { connection: connection2 }]) => {
    const toSend = [];
    const joinDelay = config.traits[name]?.join.delay || 0;

    let heartbeat;

    connection1.onopen = () => {
      connection1.emit({
        event: "register_user",
      });

      heartbeat = setInterval(() => {
        connection1.emit({
          event: "online",
        });
      }, 5000);
    };

    connection1.onerror = () => clearInterval(heartbeat);
    connection1.onclose = () => clearInterval(heartbeat);

    connection1.onmessage = async ({ data }) => {
      const isInterlocutor = name === "me";

      const { event, mine, message } = JSON.parse(data);

      if (event === "user_registered") {
        if (joinDelay) {
          await sleep(joinDelay);
        }

        return connection1.emit({
          event: "get_partner",
        });
      }

      if (event === "joined_to_conversation") {
        log(`${name} ${event}`, isInterlocutor);

        const now = Date.now();

        if (Math.abs(lastJoinedAt - now) < 10) {
          log(`recursion, terminating after ${joinDelay}ms...`, isInterlocutor);

          await sleep(joinDelay);

          connection1.emit({
            event: "get_partner",
          });

          connection2.emit({
            event: "get_partner",
          });

          return;
        }

        lastJoinedAt = now;

        connection1.alive = true;

        if (toSend.length) {
          const stale = toSend.shift();

          log(`${name}: ${stale}`, isInterlocutor);

          connection2.emit({
            event: "send_message",
            message: stale,
          });
        }

        return;
      }

      if (event === "terminate_conversation") {
        log(`${name} ${event}`, isInterlocutor);

        connection1.alive = false;

        if (config.proxy.rotate) {
          await connection1.rotate();
        }

        return connection1.emit({
          event: "get_partner",
        });
      }

      if (event === "message" && !mine) {
        if (connection2.alive) {
          log(`${name}: ${message}`, isInterlocutor);

          return connection2.emit({
            event: "send_message",
            message: message,
          });
        }

        return toSend.push(message);
      }

      if (!connection2.alive) {
        return;
      }

      if (["start_typing", "stop_typing"].includes(event)) {
        log(`${name} ${event}...`, isInterlocutor);

        return connection2.emit({ event });
      }
    };
  }
);
