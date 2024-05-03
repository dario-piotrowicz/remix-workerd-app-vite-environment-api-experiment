/* eslint-disable @typescript-eslint/no-explicit-any */

import { DevEnvironment, type ResolvedConfig } from "vite";

import { Log, Miniflare, Response as MiniflareResponse } from "miniflare";
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
  const devEnv = new DevEnvironment(name, config, {});

  const mf = new Miniflare({
    modulesRoot: fileURLToPath(new URL("./", import.meta.url)),
    log: new Log(),
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
    bindings: {
      ROOT: config.root,
    },
    serviceBindings: {
      __viteFetchModule: async (request) => {
        const args = await request.json();
        try {
          const result = await devEnv.fetchModule(...(args as [any, any]));
          return new MiniflareResponse(JSON.stringify(result));
        } catch (error) {
          console.error("[fetchModule]", args, error);
          throw error;
        }
      },
    },
  });

  let entrypointSet = false;
  (devEnv as any).api = {
    async getWorkerdHandler({ entrypoint }: { entrypoint: string }) {
      if (!entrypointSet) {
        const resp = await mf.dispatchFetch("http:0.0.0.0/__set-entrypoint", {
          headers: [["x-vite-workerd-entrypoint", entrypoint]],
        });
        entrypointSet = resp.ok;
      }

      return async (req: Request) => {
        // TODO: ideally we should pass the request itself and not req.url... but doing so
        //       causes some error... this needs to be investigated
        return await mf.dispatchFetch(
          req.url,
          // note: we disable encoding since this causes issues when the minilare response
          //       gets piped into the node one
          { headers: [["accept-encoding", "identity"]] }
        );
      };
    },
  };

  return devEnv;
}
