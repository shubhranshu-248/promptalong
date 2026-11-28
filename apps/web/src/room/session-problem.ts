/** Why the server refused a session change, in words. */
export function sessionProblem(reason: string): string {
  switch (reason) {
    case 'too-many':
      return 'A room holds up to 24 sessions. Delete one first.';
    case 'not-host':
      return 'Only the host can change sessions.';
    case 'offline':
      return 'You are offline. Try again when you are back.';
    case 'invalid':
      return 'Check the name and choose people who are in the room.';
    default:
      return 'That did not work. Try again.';
  }
}
