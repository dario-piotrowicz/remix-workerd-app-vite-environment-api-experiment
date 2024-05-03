import {
  vitePlugin as remix,
} from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { viteEnvironmentPluginWorkerd } from "./viteWorkerdEnv";

export default defineConfig({
  plugins: [viteEnvironmentPluginWorkerd(), remix(), tsconfigPaths()],
});
