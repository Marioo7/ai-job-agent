export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
