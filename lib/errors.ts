/** An error with an HTTP status and a sentence somebody can act on. */
export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AppError";
  }
}
