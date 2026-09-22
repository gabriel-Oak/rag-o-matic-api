import type { AxiosRequestConfig } from "axios";

export interface IHttpService {
  get: <T>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  post: <T>(url: string, payload: unknown, config?: AxiosRequestConfig) => Promise<T>;
}
