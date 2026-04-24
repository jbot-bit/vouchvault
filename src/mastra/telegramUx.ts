export const TARGET_USERNAME_PLACEHOLDER = "@businessname";

const THREADED_LAUNCHER_COMMANDS = new Set([
  "/start",
  "/help",
  "/vouch",
  "/verify",
]);

export function shouldSendThreadedLauncherReply(command: string): boolean {
  return THREADED_LAUNCHER_COMMANDS.has(command.trim().toLowerCase());
}

export function buildThreadedGroupReplyOptions(replyToMessageId: number) {
  return {
    replyToMessageId,
    allowSendingWithoutReply: true,
    disableNotification: true,
  };
}

export function buildTargetForceReplyMarkup() {
  return {
    force_reply: true,
    input_field_placeholder: TARGET_USERNAME_PLACEHOLDER,
  };
}
