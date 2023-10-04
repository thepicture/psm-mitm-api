const Websocket = require("websocket").w3cwebsocket;
const { HttpsProxyAgent } = require("https-proxy-agent");
const { Worker, receiveMessageOnPort } = require("node:worker_threads");
const config = require("./config");

const { port1: localPort, port2: workerPort } = new MessageChannel();

const buffer = new Int32Array(new SharedArrayBuffer(4));

new Worker("./fetcher.js", {
  workerData: { buffer, port: workerPort },
  transferList: [workerPort],
});

Atomics.wait(buffer, 0, 0);

const { message: proxy } = receiveMessageOnPort(localPort);

const log = (message, isInterlocutor) => {
  const date = `[${new Date().toISOString()}] `;
  const shift = isInterlocutor ? 0 : process.stdout.columns;
  const prefix = isInterlocutor ? `${date} ` : "";
  const postfix = isInterlocutor ? "" : ` ${date}`;
  const formatted = `${prefix}${message}${postfix}`.padStart(shift);

  return console.log(formatted);
};

const websocketArgs = [
  "ws://pogovorisomnoi.ru:8008/chat",
  null,
  null,
  {
    "user-agent": Math.random().toString(),
  },
  null,
  {
    tlsOptions: {
      agent: new HttpsProxyAgent(proxy),
    },
  },
];

let mounted = false;

const [bot1, bot2] = ["you", "me"].map((name) => {
  let ws = new Websocket(...websocketArgs);
  ws.emit = (json) => ws.send(JSON.stringify(json));

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

    const isInterlocutor = who === "me";

    const which = isInterlocutor ? bot1 : bot2;

    log(
      `${which.name} intercepted with "${message.trimEnd()}"`,
      isInterlocutor
    );

    which.connection.emit({
      event: "send_message",
      message,
    });
  });
}

[
  [bot1, bot2],
  [bot2, bot1],
].forEach(
  ([{ connection: connection1, name }, { connection: connection2 }]) => {
    const toSend = [];

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
        return connection1.emit({
          event: "get_partner",
        });
      }

      if (event === "joined_to_conversation") {
        log(`${name} ${event}`, isInterlocutor);

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
