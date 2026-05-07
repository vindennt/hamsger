export type User = "Alice" | "Bob";

export interface Message {
  id: string;
  sender: User;
  text: string;
  timestamp: Date;
}

// Example Initial Messages.
// TODO: replace with a device loaded log
export const INITIAL_MESSAGES: Message[] = [
  {
    id: "1",
    sender: "Alice",
    text: "Welcome to the encrypted chat room!",
    timestamp: new Date(Date.now() - 60000 * 5),
  },
  {
    id: "2",
    sender: "Bob",
    text: "Hi Alice!",
    timestamp: new Date(Date.now() - 60000 * 4),
  },
  {
    id: "3",
    sender: "Alice",
    text: "Hi Bob, I have to go now. Bye!",
    timestamp: new Date(Date.now() - 60000 * 3),
  },
  {
    id: "4",
    sender: "Bob",
    text: "Bye Alice!",
    timestamp: new Date(Date.now() - 60000 * 2),
  },
];
