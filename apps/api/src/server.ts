import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { openProjectStore, type ProjectStore } from '@h3storyboard/project-store';
import type { CharacterImageJob } from '@h3storyboard/protocol';
import { errorResponse } from './api-error.js';
import { sendJson } from './http.js';
import { dispatchRoute } from './routes.js';
import { serveMediaRoute } from './media-routes.js';
import { serveCharacterUploadRoute } from './character-upload-routes.js';

export interface ApiServerOptions {
  database_path: string;
  host?: string;
  port?: number;
  data_directory?: string;
  character_image_lora_allowlist?: readonly string[];
  cancel_character_image_job?: (
    jobId: string,
    reason: string,
  ) => Promise<CharacterImageJob>;
}

export interface ApiServerAddress {
  host: string;
  port: number;
  origin: string;
}

export interface ApiServer {
  start(): Promise<ApiServerAddress>;
  close(): Promise<void>;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4187;
  const store = openProjectStore(options.database_path);
  const dataDirectory = resolve(options.data_directory ?? dirname(options.database_path));
  const server = buildHttpServer(store, dataDirectory, {
    lora_allowlist: new Set(options.character_image_lora_allowlist ?? []),
    ...(options.cancel_character_image_job ? {
      cancel_character_image_job: options.cancel_character_image_job,
    } : {}),
  });
  let started = false;
  let closed = false;
  let closing = false;
  let startPromise: Promise<ApiServerAddress> | null = null;
  let closePromise: Promise<void> | null = null;

  return {
    async start() {
      if (closed || closing) throw new Error('Cannot start a closed API server');
      if (started) return serverAddress(server, host);
      if (!startPromise) {
        startPromise = (async () => {
          try {
            await new Promise<void>((resolve, reject) => {
              const onError = (error: Error) => {
                server.off('listening', onListening);
                reject(error);
              };
              const onListening = () => {
                server.off('error', onError);
                resolve();
              };
              server.once('error', onError);
              server.once('listening', onListening);
              server.listen(port, host);
            });
          } catch (error) {
            store.close();
            closed = true;
            throw error;
          }
          started = true;
          return serverAddress(server, host);
        })();
      }
      try {
        return await startPromise;
      } finally {
        startPromise = null;
      }
    },
    async close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        try {
          if (startPromise) {
            try {
              await startPromise;
            } catch {
              // A failed start already closes the store in start().
            }
          }
          if (server.listening) {
            await new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            });
          }
        } finally {
          if (!closed) store.close();
          started = false;
          closed = true;
          closing = false;
        }
      })();
      return closePromise;
    },
  };
}

function buildHttpServer(store: ProjectStore, dataDirectory: string,
  characterImageJobs: Parameters<typeof dispatchRoute>[2]): Server {
  return createServer(async (request, response) => {
    try {
      if (await serveCharacterUploadRoute(
        request, response, store, dataDirectory)) return;
      if (await serveMediaRoute(request, response, store, dataDirectory)) return;
      const result = await dispatchRoute(request, store, characterImageJobs);
      sendJson(response, result.status, { data: result.body });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const result = errorResponse(error);
      sendJson(response, result.status, result.body);
    }
  });
}

function serverAddress(server: Server, host: string): ApiServerAddress {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('API server does not have a TCP address');
  }
  return {
    host,
    port: address.port,
    origin: `http://${host}:${address.port}`,
  };
}
