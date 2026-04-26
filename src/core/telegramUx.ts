export const TARGET_USER_REQUEST_ID = 1001;

const THREADED_LAUNCHER_COMMANDS = new Set(["/start", "/help", "/vouch"]);

export function shouldSendThreadedLauncherReply(command: string): boolean {
  return THREADED_LAUNCHER_COMMANDS.has(command.trim().toLowerCase());
}

// "Threaded" here means reply-thread (i.e. reply_parameters), not
// forum-topic thread. For forum-mode supergroups, also pass the
// inbound message's message_thread_id so the response stays in the
// correct topic. Bot API:
// https://core.telegram.org/bots/api#sendmessage (message_thread_id).
export function buildThreadedGroupReplyOptions(
  replyToMessageId: number,
  messageThreadId?: number | null,
) {
  return {
    replyToMessageId,
    allowSendingWithoutReply: true,
    disableNotification: true,
    ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
  };
}

export function buildTargetRequestReplyMarkup() {
  return {
    keyboard: [
      [
        {
          text: "Choose Target",
          request_users: {
            request_id: TARGET_USER_REQUEST_ID,
            user_is_bot: false,
            max_quantity: 1,
            request_name: true,
            request_username: true,
          },
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Choose a target",
  };
}

export function buildReplyKeyboardRemove() {
  return {
    remove_keyboard: true,
  };
}
