-- Stop and confirm the old Worker exited before applying this release.
ALTER TYPE "JobExecutionLane" ADD VALUE IF NOT EXISTS 'ARCHIVE_DOWNLOAD';
