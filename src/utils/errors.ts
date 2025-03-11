export class NotFoundError extends Error {
  constructor(reason?: string) {
    super(`Couldn't find a stream: ${reason ?? 'not found'}`);
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? 'Operation timed out');
    this.name = 'TimeoutError';
  }
}
