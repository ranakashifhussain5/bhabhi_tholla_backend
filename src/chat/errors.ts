export class ChatError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ChatError';
  }
}
