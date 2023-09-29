"use strict";

const {
  workerData: { buffer, port },
} = require("node:worker_threads");
const https = require("node:https");

const proxyRegex = /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]+/g;

(async () => {
  const proxy = await new Promise((resolve, reject) => {
    https.get("https://free-proxy-list.net/", (response) => {
      response.on("error", reject);

      response.setEncoding("utf8");

      let html = "";

      response.on("data", (chunk) => {
        html += chunk;
      });

      response.on("end", () => {
        const proxies = html.match(proxyRegex);

        resolve(
          `http://${proxies[Math.floor(Math.random() * proxies.length)]}`
        );
      });
    });
  });

  port.postMessage(proxy);

  Atomics.notify(buffer, 0);
})();
