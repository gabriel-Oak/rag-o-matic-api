import type { AxiosInstance, AxiosRequestConfig } from "axios";
import type { IHttpService } from "./types.js";

export default class HttpService implements IHttpService {
  constructor(private readonly client: AxiosInstance) {}

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await this.client.get<T>(url, config);
    return data;
  }

  async post<T>(url: string, payload: unknown, config?: AxiosRequestConfig): Promise<T> {
    const { data } = await this.client.post<T>(url, payload, config);
    return data;
  }
}
