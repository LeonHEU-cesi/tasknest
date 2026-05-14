const DEFAULT_API_URL = 'http://localhost:4000';

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly payload: ApiError;

  constructor(status: number, payload: ApiError) {
    const text = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
    super(text || `Request failed with status ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.payload = payload;
  }
}

function getBaseUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL
      : DEFAULT_API_URL;
  return fromEnv.replace(/\/$/, '');
}

async function request<TResponse>(
  method: string,
  path: string,
  body?: unknown,
): Promise<TResponse> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  const response = await fetch(`${getBaseUrl()}/api/v1${path}`, init);

  if (response.status === 204) {
    return undefined as unknown as TResponse;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      statusCode: response.status,
      message: response.statusText,
    }))) as ApiError;
    throw new ApiClientError(response.status, payload);
  }

  return (await response.json()) as TResponse;
}

export function apiGet<TResponse>(path: string): Promise<TResponse> {
  return request<TResponse>('GET', path);
}

export function apiPost<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return request<TResponse>('POST', path, body);
}

export function apiPatch<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  return request<TResponse>('PATCH', path, body);
}
