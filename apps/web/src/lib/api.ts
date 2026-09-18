import type { ApiError } from '@mtg/shared';
import { config } from './config';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const request: RequestInit = {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
  };
  if (init.body !== undefined) {
    request.headers = { 'content-type': 'application/json' };
    request.body = JSON.stringify(init.body);
  }
  const res = await fetch(`${config.apiUrl}${path}`, request);
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.error ?? 'unknown', err.message ?? res.statusText);
  }
  return data as T;
}
