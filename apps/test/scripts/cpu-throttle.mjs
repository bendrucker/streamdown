/**
 * Sets Chrome's CPU throttling rate on the page under measurement.
 *
 * The bench harness runs on hardware with far more headroom than the devices
 * that struggle with streaming markdown. A change that removes real work can be
 * invisible at full speed and decisive at 4x, so scenarios are worth running at
 * more than one rate.
 *
 * agent-browser has no raw CDP passthrough, so this talks to the endpoint it
 * reports directly.
 */

import { execFileSync } from "node:child_process";
import { once } from "node:events";

const cdpUrl = (session) =>
  execFileSync("agent-browser", ["--session", session, "get", "cdp-url"], {
    encoding: "utf8",
  })
    .split("\n")
    .find((line) => line.startsWith("ws://"));

const pageTarget = async (browserWsUrl, url) => {
  const { port } = new URL(browserWsUrl);
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && target.url.startsWith(url)
  );
  if (!page) {
    throw new Error(`no page target at ${url}`);
  }
  return page.webSocketDebuggerUrl;
};

// No CDP domains are enabled, so nothing arrives unsolicited and the next
// message is the reply to the command just sent.
const send = async (socket, method, params) => {
  socket.send(JSON.stringify({ id: 1, method, params }));
  const [event] = await once(socket, "message");
  const message = JSON.parse(event.data);
  if (message.error) {
    throw new Error(message.error.message);
  }
  return message.result;
};

/**
 * Chrome drops emulation overrides when the client that set them detaches, so
 * the returned handle has to stay open for as long as the throttling should
 * apply. Callers close it once the scenario has finished.
 */
export const throttleCpu = async ({ session, url, rate }) => {
  const socket = new WebSocket(await pageTarget(cdpUrl(session), url));
  await once(socket, "open");
  await send(socket, "Emulation.setCPUThrottlingRate", { rate });
  return { close: () => socket.close() };
};
