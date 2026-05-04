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
