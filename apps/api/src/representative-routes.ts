import {
  MarkRepresentativeInputSchema,
  ReviewRepresentativeInputSchema,
} from '@h3storyboard/protocol';
import type { ProjectStore } from '@h3storyboard/project-store';
import type { IncomingMessage } from 'node:http';
import { readJson } from './http.js';

interface Result { status: number; body: unknown }
const MARK = /^\/api\/actuals\/([^/]+)\/representative$/;
const REVIEW = /^\/api\/actuals\/([^/]+)\/representative\/review$/;

export async function dispatchRepresentativeRoute(request: IncomingMessage,
  store: ProjectStore, method: string, pathname: string): Promise<Result | null> {
  const review = REVIEW.exec(pathname);
  if (review && method === 'POST') return { status: 200,
    body: store.takes.reviewRepresentative(decodeURIComponent(review[1] ?? ''),
      ReviewRepresentativeInputSchema.parse(await readJson(request))) };
  const mark = MARK.exec(pathname);
  if (mark && method === 'POST') return { status: 200,
    body: store.takes.markRepresentative(decodeURIComponent(mark[1] ?? ''),
      MarkRepresentativeInputSchema.parse(await readJson(request))) };
  return null;
}
