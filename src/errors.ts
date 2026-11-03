/** A problem the user can fix by changing a file, a flag, or the environment. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
