import { nodeResolve } from '@rollup/plugin-node-resolve';
import { createHash } from 'crypto';
import esbuild from 'esbuild';
import { readFile } from 'fs/promises';
import path from 'path';
import { rollup, Plugin as RollupPlugin } from 'rollup';
import esbuildPlugin from 'rollup-plugin-esbuild';
import { Plugin } from 'vite';
import './env';

export function serviceWorkerPlugin(options?: {
  mountPoint?: string;
  esbuildTarget?: string;
  workerAllowedHeader?: string;
  rollupPlugins?: RollupPlugin[];
}): Plugin {
  const mountPoint = options?.mountPoint ?? '/@service-worker/';
  const workerAllowedHeader =
    options &&
    Object.prototype.hasOwnProperty.call(options, 'workerAllowedHeader')
      ? options.workerAllowedHeader
      : '/';
  const suffix = '?service-worker';
  const prefix = '\0service-worker';
  async function loadWorkerCode(filename: string, compress: boolean) {
    const bundle = await rollup({
      input: filename,
      treeshake: compress,
      plugins: options?.rollupPlugins ?? [
        esbuildPlugin({
          target: options?.esbuildTarget ?? 'es2020',
        }),
        nodeResolve({
          browser: true,
        }),
      ],
    });
    const result = await bundle.generate({ sourcemap: false });
    await bundle.close();
    const code = result.output[0].code;
    if (!compress) {
      return code;
    }
    const minified = await esbuild.transform(code, {
      minify: true,
      treeShaking: true,
    });
    return minified.code;
  }
  const knownWorkerFiles: Set<string> = new Set();
  return {
    name: 'service-worker',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source.endsWith(suffix)) {
        const resolved = await this.resolve(
          source.substring(0, source.length - suffix.length),
          importer
        );
        return `${prefix}${resolved?.id}`;
      }
      return;
    },
    async load(id) {
      if (id.startsWith(prefix)) {
        const filename = id.substring(prefix.length);
        if (this.meta.watchMode) {
          if (!this.getWatchFiles().includes(filename)) {
            this.addWatchFile(filename);
          }
          const data = await readFile(filename);
          const hash = createHash('sha1');
          hash.update(data);
          hash.end();
          const digest = hash.digest('hex');
          return `export default "${mountPoint}${filename}?${digest}";`;
        }
        const code = await loadWorkerCode(filename, true);
        const handle = this.emitFile({
          type: 'asset',
          name: `${path.basename(filename, path.extname(filename))}.js`,
          source: code,
        });
        return `export default "${this.getFileName(handle)}";`;
      }
      return;
    },
    configureServer(server) {
      server.middlewares.use(mountPoint, async (req, res, next) => {
        if (req.originalUrl) {
          try {
            const filename = req.originalUrl.substring(
              mountPoint.length,
              req.originalUrl.indexOf('?') === -1
                ? req.originalUrl.length
                : req.originalUrl.indexOf('?')
            );
            const code = await loadWorkerCode(filename, false);
            knownWorkerFiles.add(filename);
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'max-age=360000');
            if (workerAllowedHeader) {
              res.setHeader('Service-Worker-Allowed', workerAllowedHeader);
            }
            res.end(code);
          } catch (err) {
            next(err);
          }
        } else {
          next();
        }
      });
    },
    async handleHotUpdate(ctx) {
      if (knownWorkerFiles.has(ctx.file)) {
        ctx.server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
