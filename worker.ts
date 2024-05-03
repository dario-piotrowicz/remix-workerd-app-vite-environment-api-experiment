/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */

import { ModuleRunner } from "vite/module-runner";

type Env = {
  ROOT: string;
  UNSAFE_EVAL: {
    eval: (code: string, filename?: string) => any;
  };
  __viteFetchModule: {
    fetch: (request: Request) => Promise<Response>;
  };
  root: string;
};

let entrypoint: any;

export default {
  async fetch(req: Request, env: Env, ctx: any) {
    const url = new URL(req.url);

    const moduleRunner = await getModuleRunner(env);

    if(url.pathname === '/__set-entrypoint') {
        const viteWorkerdEntrypoint = req.headers.get('x-vite-workerd-entrypoint');
        entrypoint = await moduleRunner.import(viteWorkerdEntrypoint!);
        return new Response('entrypoint successfully set');
    }

    return entrypoint.default(req);
  },
};

let _moduleRunner: ModuleRunner|undefined;

async function getModuleRunner(env: Env) {
  if (_moduleRunner) return _moduleRunner;
  _moduleRunner = new ModuleRunner(
      {
        root: env.ROOT,
        transport: {
          fetchModule: async (...args) => {
            const response = await env.__viteFetchModule.fetch(
              new Request('http://localhost', {
                method: 'POST',
                body: JSON.stringify(args),
              }),
            );
            const result = response.json();
            return result as any;
          },
        },
        hmr: false,
      },
      {
        runInlinedModule: async (context, transformed, id) => {
          const codeDefinition = `'use strict';async (${Object.keys(context).join(
            ',',
          )})=>{{`;
          const code = `${codeDefinition}${transformed}\n}}`;
          const fn = env.UNSAFE_EVAL.eval(code, id);
          await fn(...Object.values(context));
          Object.freeze(context.__vite_ssr_exports__);
        },
        async runExternalModule(filepath) {
          return import(filepath);
        },
      },
  );
  return _moduleRunner;
}