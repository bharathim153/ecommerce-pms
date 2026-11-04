import axios, { AxiosError } from "axios";

export const TOKEN_KEY = "pms_token";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  headers: { Accept: "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event("pms:unauthenticated"));
    }
    return Promise.reject(error);
  },
);

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface ApiErrorInfo {
  message: string;
  fieldErrors: Record<string, string>;
  status?: number;
}

/** Normalises Laravel error payloads (our envelope and the 422 validation format). */
export function parseError(err: unknown): ApiErrorInfo {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as
      | { message?: string; errors?: Record<string, string[] | string> }
      | undefined;
    const fieldErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(body?.errors ?? {})) {
      fieldErrors[k] = Array.isArray(v) ? v[0] : String(v);
    }
    return {
      message: body?.message ?? (err.response ? "Request failed." : "Cannot reach the server."),
      fieldErrors,
      status: err.response?.status,
    };
  }
  return { message: "Something went wrong.", fieldErrors: {} };
}
