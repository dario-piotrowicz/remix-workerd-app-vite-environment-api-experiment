/* eslint-disable @typescript-eslint/no-explicit-any */

import { DevEnvironment, type HMRChannel, type ResolvedConfig } from "vite";

import {
  Miniflare,
  Response as MiniflareResponse,
  type TypedEventListener,
  type WebSocket,
} from "miniflare";
import { fileURLToPath } from "node:url";

export function viteEnvironmentPluginWorkerd() {
  return {
    name: "vite-environment-plugin-workerd",

    async config() {
      return {
        environments: {
          workerd: {
            dev: {
              createEnvironment(
                name: string,
                config: ResolvedConfig
              ): Promise<DevEnvironment> {
                return createWorkerdDevEnvironment(name, config);
              },
            },
          },
        },
      };
    },
  };
}

async function createWorkerdDevEnvironment(
  name: string,
  config: any
): Promise<DevEnvironment> {
  const mf = new Miniflare({
    modulesRoot: fileURLToPath(new URL("./", import.meta.url)),
    modules: [
      {
        type: "ESModule",
        path: fileURLToPath(
          new URL(".vite-env-dist/worker.js", import.meta.url)
        ),
      },
    ],
    unsafeEvalBinding: "UNSAFE_EVAL",
    compatibilityDate: "2024-02-08",
    compatibilityFlags: ["nodejs_compat"],
    // TODO: we should read this from a toml file and not hardcode it
    kvNamespaces: ["MY_KV"],
    bindings: {
      ROOT: config.root,
    },
    serviceBindings: {
      __viteFetchModule: async (request) => {
        const args = await request.json();
        try {
          const result: any = await devEnv.fetchModule(...(args as [any, any]));
          return new MiniflareResponse(JSON.stringify(result));
        } catch (error) {
          console.error("[fetchModule]", args, error);
          throw error;
        }
      },
    },
  });

  const resp = await mf.dispatchFetch("http:0.0.0.0/__init-module-runner", {
    headers: {
      upgrade: "websocket",
    },
  });
  if (!resp.ok) {
    throw new Error("Error: failed to initialize the module runner!");
  }

  const webSocket = resp.webSocket;

  if (!webSocket) {
    console.error(
      "\x1b[33m⚠️ failed to create a websocket for HMR (hmr disabled)\x1b[0m"
    );
  }

  const hot = webSocket ? createHMRChannel(webSocket!, name) : false;

  const devEnv = new DevEnvironment(name, config, { hot });

  let entrypointSet = false;
  (devEnv as any).api = {
    async getWorkerdHandler({ entrypoint }: { entrypoint: string }) {
      if (!entrypointSet) {
        const resp = await mf.dispatchFetch("http:0.0.0.0/__set-entrypoint", {
          headers: [["x-vite-workerd-entrypoint", entrypoint]],
        });
        if (resp.ok) {
          entrypointSet = resp.ok;
        } else {
          throw new Error(
            `failed to set entrypoint (error: "${resp.statusText}")`
          );
        }
      }

      return async (req: Request) => {
        // TODO: ideally we should pass the request itself with close to no tweaks needed... this needs to be investigated
        return await mf.dispatchFetch(req.url, {
          method: req.method,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          body: req.body,
          duplex: "half",
          headers: [
            // note: we disable encoding since this causes issues when the miniflare response
            //       gets piped into the node one
            ["accept-encoding", "identity"],
            ...req.headers,
          ],
        });
      };
    },
  };

  return devEnv;
}
function createHMRChannel(webSocket: WebSocket, name: string): HMRChannel {
  webSocket.accept();

  const hotEventListenersMap = new Map<
    string,
    Set<(...args: any[]) => unknown>
  >();
  let hotDispose: (() => void) | undefined;

  return {
    name,
    listen() {
      const listener: TypedEventListener<MessageEvent> = (data) => {
        const payload = JSON.parse(data as unknown as string);
        for (const f of hotEventListenersMap.get(payload.event)!) {
          f(payload.data);
        }
      };

      webSocket.addEventListener("message", listener as any);
      hotDispose = () => {
        webSocket.removeEventListener("message", listener as any);
      };
    },
    close() {
      hotDispose?.();
      hotDispose = undefined;
    },
    on(event: string, listener: (...args: any[]) => any) {
      if (!hotEventListenersMap.get(event)) {
        hotEventListenersMap.set(event, new Set());
      }
      hotEventListenersMap.get(event)!.add(listener);
    },
    off(event: string, listener: (...args: any[]) => any) {
      hotEventListenersMap.get(event)!.delete(listener);
    },
    send(...args: any[]) {
      let payload: any;
      if (typeof args[0] === "string") {
        payload = {
          type: "custom",
          event: args[0],
          data: args[1],
        };
      } else {
        payload = args[0];
      }
      webSocket.send(JSON.stringify(payload));
    },
  };
}
