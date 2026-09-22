import axios, { type AxiosInstance } from "axios";
import HttpService from "./http-service.js";
import type { IHttpService } from "./types.js";

export function createHttpService(client?: AxiosInstance): IHttpService {
  const instance = client ?? axios.create();
  return new HttpService(instance);
}
