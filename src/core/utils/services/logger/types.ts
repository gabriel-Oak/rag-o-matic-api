export interface ILoggerService {
  info: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  debug: (message: string, data?: unknown) => void;
}
