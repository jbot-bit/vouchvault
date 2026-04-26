import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseSelectedTags } from "./archive.ts";
import { createTokenBucket } from "./tokenBucket.ts";
import { getLegacyBotSenders } from "./legacyBotSenders.ts";
import { publishArchiveEntryRecord } from "./archivePublishing.ts";
import {
  getPrimaryGroupChatId,
  isAllowedGroupChatId,
  refreshGroupLauncher,
} from "./archiveLauncher.ts";
import {
  createArchiveEntry,
  getArchiveEntryByLegacySource,
  getOrCreateBusinessProfile,
} from "./archiveStore.ts";
import {
  getLegacyExportMessages,
  parseLegacyExportMessage,
  resolveLegacySourceChatId,
  sortLegacyMessages,
  type LegacyImportCandidate,
  type LegacyReviewItem,
  type LegacySummaryBucket,
} from "./legacyImportParser.ts";

type LoggerLike = Pick<Console, "info" | "warn" | "error">;

export type LegacyImportSummary = {
  totalScanned: number;
  imported: number;
  wouldImport: number;
  resumedPending: number;
  skippedMissingReviewer: number;
  skippedMissingTarget: number;
  skippedMultipleTargets: number;
  skippedUnclearSentiment: number;
  skippedBotSender: number;
  skippedDuplicates: number;
  skippedOther: number;
  launcherRefreshed: boolean;
};

export type LegacyReplayFailure = {
  stage: "entry_conflict" | "publish" | "launcher_refresh";
  message: string;
  sourceMessageId?: number;
  entryId?: number;
};

export type LegacyReplayResult = {
  completed: boolean;
  sourceChatId: number;
  targetGroupChatId: number;
  reviewReportPath: string;
  checkpointPath: string;
  summary: LegacyImportSummary;
  failure: LegacyReplayFailure | null;
};

export type ReplayLegacyExportInput = {
  exportFilePath: string;
  reviewReportPath?: string;
  checkpointPath?: string;
  sourceChatId?: number | null;
  targetGroupChatId?: number | null;
  dryRun?: boolean;
  maxImports?: number;
  throttleMs?: number;
  logger?: LoggerLike;
};
export type LegacyReplayCheckpoint = {
  status: "running" | "completed" | "failed";
  exportFilePath: string;
  reviewReportPath: string;
  sourceChatId: number;
  targetGroupChatId: number;
  dryRun: boolean;
  startedAt: string;
  updatedAt: string;
  summary: LegacyImportSummary;
  lastProcessedSourceMessageId: number | null;
  lastProcessedOriginalDate: string | null;
  lastImportedEntryId: number | null;
  lastImportedSourceMessageId: number | null;
  failure: LegacyReplayFailure | null;
};

function resolveReplayTargetChatId(targetGroupChatId?: number | null): number {
  if (targetGroupChatId != null) {
    return targetGroupChatId;
  }

  const resolved = getPrimaryGroupChatId();
  if (!isAllowedGroupChatId(resolved)) {
    throw new Error(`Replay target chat ${resolved} is not in TELEGRAM_ALLOWED_CHAT_IDS.`);
  }

  return resolved;
}

function buildDefaultReviewReportPath(exportFilePath: string): string {
  const parsedPath = path.parse(exportFilePath);
  return path.join(parsedPath.dir, `${parsedPath.name}.legacy-import-review.json`);
}

function buildDefaultCheckpointPath(exportFilePath: string): string {
  const parsedPath = path.parse(exportFilePath);
  return path.join(parsedPath.dir, `${parsedPath.name}.legacy-import-checkpoint.json`);
}

function createInitialSummary(): LegacyImportSummary {
  return {
    totalScanned: 0,
    imported: 0,
    wouldImport: 0,
    resumedPending: 0,
    skippedMissingReviewer: 0,
    skippedMissingTarget: 0,
    skippedMultipleTargets: 0,
    skippedUnclearSentiment: 0,
    skippedBotSender: 0,
    skippedDuplicates: 0,
    skippedOther: 0,
    launcherRefreshed: false,
  };
}

function incrementSummary(summary: LegacyImportSummary, bucket: LegacySummaryBucket) {
  if (bucket === "missing_reviewer") {
    summary.skippedMissingReviewer += 1;
    return;
  }

  if (bucket === "missing_target") {
    summary.skippedMissingTarget += 1;
    return;
  }

  if (bucket === "unclear_sentiment") {
    summary.skippedUnclearSentiment += 1;
    return;
  }

  if (bucket === "multiple_targets") {
    summary.skippedMultipleTargets += 1;
    return;
  }

  if (bucket === "bot_sender") {
    summary.skippedBotSender += 1;
    return;
  }

  summary.skippedOther += 1;
}

function validateExistingLegacyEntry(input: {
  existingEntry: {
    id: number;
    chatId: number;
    reviewerUsername: string;
    targetUsername: string;
    entryType: string;
    result: string;
    selectedTags: string;
    source: string;
  };
  candidate: LegacyImportCandidate;
  targetGroupChatId: number;
}): string | null {
  const mismatches: string[] = [];

  if (input.existingEntry.source !== "legacy_import") {
    mismatches.push(`source=${input.existingEntry.source}`);
  }

  if (input.existingEntry.chatId !== input.targetGroupChatId) {
    mismatches.push(`chatId=${input.existingEntry.chatId}`);
  }

  if (input.existingEntry.reviewerUsername !== input.candidate.reviewerUsername) {
    mismatches.push(`reviewer=${input.existingEntry.reviewerUsername}`);
  }

  if (input.existingEntry.targetUsername !== input.candidate.targetUsername) {
    mismatches.push(`target=${input.existingEntry.targetUsername}`);
  }

  if (input.existingEntry.entryType !== input.candidate.entryType) {
    mismatches.push(`entryType=${input.existingEntry.entryType}`);
  }

  if (input.existingEntry.result !== input.candidate.result) {
    mismatches.push(`result=${input.existingEntry.result}`);
  }

  const existingTags = parseSelectedTags(input.existingEntry.selectedTags);
  if (
    existingTags.length !== input.candidate.selectedTags.length ||
    existingTags.some((tag, index) => tag !== input.candidate.selectedTags[index])
  ) {
    mismatches.push(`tags=${existingTags.join(",") || "none"}`);
  }

  if (mismatches.length === 0) {
    return null;
  }

  return `Legacy source ${input.candidate.sourceChatId}/${input.candidate.sourceMessageId} already maps to entry #${input.existingEntry.id} with mismatched data (${mismatches.join("; ")}).`;
}

async function writeLegacyReviewReport(input: {
  exportFilePath: string;
  reviewReportPath: string;
  checkpointPath: string;
  sourceChatId: number;
  targetGroupChatId: number;
  dryRun: boolean;
  summary: LegacyImportSummary;
  skipped: LegacyReviewItem[];
  failure: LegacyReplayFailure | null;
}) {
  await mkdir(path.dirname(input.reviewReportPath), { recursive: true });

  await writeFile(
    input.reviewReportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        exportFilePath: input.exportFilePath,
        sourceChatId: input.sourceChatId,
        targetGroupChatId: input.targetGroupChatId,
        dryRun: input.dryRun,
        checkpointPath: input.checkpointPath,
        summary: input.summary,
        failure: input.failure,
        skipped: input.skipped,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeLegacyCheckpoint(input: {
  checkpointPath: string;
  checkpoint: LegacyReplayCheckpoint;
}) {
  await mkdir(path.dirname(input.checkpointPath), { recursive: true });
  await writeFile(input.checkpointPath, JSON.stringify(input.checkpoint, null, 2), "utf8");
}

export async function replayLegacyExport(
  input: ReplayLegacyExportInput,
): Promise<LegacyReplayResult> {
  const logger = input.logger ?? console;
  const dryRun = input.dryRun === true;
  const throttleMs = input.throttleMs ?? 3100;
  const sendBucket = !dryRun ? createTokenBucket(throttleMs) : null;
  const maxImports = input.maxImports ?? null;
  const exportFilePath = path.resolve(input.exportFilePath);
  const reviewReportPath = path.resolve(
    input.reviewReportPath ?? buildDefaultReviewReportPath(exportFilePath),
  );
  const checkpointPath = path.resolve(
    input.checkpointPath ?? buildDefaultCheckpointPath(exportFilePath),
  );

  const exportData = JSON.parse(await readFile(exportFilePath, "utf8"));
  const sourceChatId = resolveLegacySourceChatId(exportData, input.sourceChatId ?? null);
  const targetGroupChatId = resolveReplayTargetChatId(input.targetGroupChatId ?? null);
  const sortedMessages = sortLegacyMessages(getLegacyExportMessages(exportData));
  const botSenders = getLegacyBotSenders();

  const summary = createInitialSummary();
  const skipped: LegacyReviewItem[] = [];
  let failure: LegacyReplayFailure | null = null;
  let lastPublishedReplayChatId: number | null = null;
  let lastProcessedSourceMessageId: number | null = null;
  let lastProcessedOriginalDate: string | null = null;
  let lastImportedEntryId: number | null = null;
  let lastImportedSourceMessageId: number | null = null;
  const startedAt = new Date().toISOString();

  async function persistCheckpoint(status: LegacyReplayCheckpoint["status"]) {
    await writeLegacyCheckpoint({
      checkpointPath,
      checkpoint: {
        status,
        exportFilePath,
        reviewReportPath,
        sourceChatId,
        targetGroupChatId,
        dryRun,
        startedAt,
        updatedAt: new Date().toISOString(),
        summary: { ...summary },
        lastProcessedSourceMessageId,
        lastProcessedOriginalDate,
        lastImportedEntryId,
        lastImportedSourceMessageId,
        failure,
      },
    });
  }

  await persistCheckpoint("running");

  for (const message of sortedMessages) {
    summary.totalScanned += 1;

    const decision = parseLegacyExportMessage({ message, sourceChatId, botSenders });
    if (decision.kind === "skip") {
      incrementSummary(summary, decision.bucket);
      skipped.push(decision.reviewItem);
      lastProcessedSourceMessageId = decision.reviewItem.sourceMessageId;
      lastProcessedOriginalDate = decision.reviewItem.originalDate;
      await persistCheckpoint("running");
      continue;
    }

    const candidate = decision.candidate;
    lastProcessedSourceMessageId = candidate.sourceMessageId;
    lastProcessedOriginalDate = candidate.originalTimestamp.toISOString().slice(0, 10);
    const existingEntry = await getArchiveEntryByLegacySource({
      legacySourceChatId: candidate.sourceChatId,
      legacySourceMessageId: candidate.sourceMessageId,
    });

    if (existingEntry) {
      const conflict = validateExistingLegacyEntry({
        existingEntry,
        candidate,
        targetGroupChatId,
      });

      if (conflict) {
        failure = {
          stage: "entry_conflict",
          message: conflict,
          sourceMessageId: candidate.sourceMessageId,
          entryId: existingEntry.id,
        };
        break;
      }

      if (existingEntry.status === "publishing" && existingEntry.publishedMessageId == null) {
        failure = {
          stage: "publish",
          message: `Legacy entry #${existingEntry.id} is already in publishing state without a stored Telegram message id. Check the target group before resuming replay.`,
          sourceMessageId: candidate.sourceMessageId,
          entryId: existingEntry.id,
        };
        break;
      }

      if (existingEntry.publishedMessageId != null) {
        summary.skippedDuplicates += 1;
        lastPublishedReplayChatId = existingEntry.chatId;
        await persistCheckpoint("running");
        continue;
      }

      if (dryRun) {
        summary.wouldImport += 1;
        lastPublishedReplayChatId = existingEntry.chatId;
        await persistCheckpoint("running");
        continue;
      }

      try {
        if (sendBucket) {
          await sendBucket.take();
        }
        await publishArchiveEntryRecord(existingEntry, logger);
        summary.imported += 1;
        summary.resumedPending += 1;
        lastPublishedReplayChatId = existingEntry.chatId;
        lastImportedEntryId = existingEntry.id;
        lastImportedSourceMessageId = candidate.sourceMessageId;
        await persistCheckpoint("running");
      } catch (error) {
        failure = {
          stage: "publish",
          message: `Failed to publish existing legacy entry #${existingEntry.id}: ${error instanceof Error ? error.message : String(error)}`,
          sourceMessageId: candidate.sourceMessageId,
          entryId: existingEntry.id,
        };
        break;
      }

      if (maxImports != null && summary.imported >= maxImports) {
        logger.info?.({ maxImports }, "[Legacy Import] Reached --max-imports limit, stopping early.");
        break;
      }

      continue;
    }

    if (dryRun) {
      summary.wouldImport += 1;
      lastPublishedReplayChatId = targetGroupChatId;
      await persistCheckpoint("running");
      continue;
    }

    const businessProfile = await getOrCreateBusinessProfile(candidate.targetUsername);
    const createdEntry = await createArchiveEntry({
      reviewerUserId: null,
      reviewerTelegramId: candidate.reviewerTelegramId,
      reviewerUsername: candidate.reviewerUsername,
      targetProfileId: businessProfile.id,
      targetUsername: candidate.targetUsername,
      chatId: targetGroupChatId,
      entryType: candidate.entryType,
      result: candidate.result,
      selectedTags: candidate.selectedTags,
      source: "legacy_import",
      legacySourceMessageId: candidate.sourceMessageId,
      legacySourceChatId: candidate.sourceChatId,
      legacySourceTimestamp: candidate.originalTimestamp,
      createdAt: candidate.originalTimestamp,
    });

    try {
      if (sendBucket) {
        await sendBucket.take();
      }
      await publishArchiveEntryRecord(createdEntry, logger);
      summary.imported += 1;
      lastPublishedReplayChatId = createdEntry.chatId;
      lastImportedEntryId = createdEntry.id;
      lastImportedSourceMessageId = candidate.sourceMessageId;
      await persistCheckpoint("running");
    } catch (error) {
      failure = {
        stage: "publish",
        message: `Failed to publish new legacy entry #${createdEntry.id}: ${error instanceof Error ? error.message : String(error)}`,
        sourceMessageId: candidate.sourceMessageId,
        entryId: createdEntry.id,
      };
      break;
    }

    if (maxImports != null && summary.imported >= maxImports) {
      logger.info?.({ maxImports }, "[Legacy Import] Reached --max-imports limit, stopping early.");
      break;
    }
  }

  if (!dryRun && failure == null && lastPublishedReplayChatId != null) {
    try {
      await refreshGroupLauncher(lastPublishedReplayChatId, logger);
      summary.launcherRefreshed = true;
    } catch (error) {
      failure = {
        stage: "launcher_refresh",
        message: `Failed to refresh launcher for replay target ${lastPublishedReplayChatId}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  await persistCheckpoint(failure == null ? "completed" : "failed");

  await writeLegacyReviewReport({
    exportFilePath,
    reviewReportPath,
    checkpointPath,
    sourceChatId,
    targetGroupChatId,
    dryRun,
    summary,
    skipped,
    failure,
  });

  logger.info?.(
    {
      exportFilePath,
      sourceChatId,
      targetGroupChatId,
      dryRun,
      summary,
      failure,
      reviewReportPath,
      checkpointPath,
    },
    "[Legacy Import] Replay summary",
  );

  return {
    completed: failure == null,
    sourceChatId,
    targetGroupChatId,
    reviewReportPath,
    checkpointPath,
    summary,
    failure,
  };
}
