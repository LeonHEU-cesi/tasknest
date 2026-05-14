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

export async function apiPost<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const response = await fetch(`${getBaseUrl()}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      statusCode: response.status,
      message: response.statusText,
    }))) as ApiError;
    throw new ApiClientError(response.status, payload);
  }

  return (await response.json()) as TResponse;
}
