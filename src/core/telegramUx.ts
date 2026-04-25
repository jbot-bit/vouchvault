export const TARGET_USER_REQUEST_ID = 1001;

const THREADED_LAUNCHER_COMMANDS = new Set(["/start", "/help", "/vouch"]);

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
