/** Expected, user-presentable failure. `code` is stable for tests and UI logic. */
export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AppError";
  }
}
